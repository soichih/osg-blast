var fs = require('fs');

var osg = require('osg');
var readblock = require('readblock');
var Promise = require('promise');
var merge = require('merge');
var async = require('async');
var path = require('path');
var rimraf = require('rimraf');

function readfastas(file, num, callback) {
    var fastas = [];
    async.whilst(
        function() { return file.hasmore() && (num--); },
        function(next) {
            file.read("\n>", function(fasta) {
                if(fasta) {
                    fastas.push(fasta);
                }
                next();
            });
        },
        function(err) {
            callback(fastas);
        }
    );
}


/*
function padDigits(number, digits) {
    return Array(Math.max(digits - String(number).length + 1, 0)).join(0) + number;
}
*/

function load_db_info(dbinfo_path) {
    /* parses content that looks like..
    #
    # Alias file created 12/13/2013 08:36:19
    #
    TITLE Nucleotide collection (nt)
    DBLIST                  nt.00 nt.01 nt.02 nt.03 nt.04 nt.05 nt.06 nt.07 nt.08 nt.09 nt.10 nt.11 nt.12 nt.13 nt.14 nt.15 nt.16
    NSEQ 20909183
    LENGTH 52564451792
    */
    var data = fs.readFileSync(dbinfo_path, {encoding: 'utf8'});
    var dbinfo_lines = data.split("\n");

    //parse out title
    var title = dbinfo_lines[3].substring(6);
    var parts = dbinfo_lines[4].substring(7).trim().split(" ");
    var num_seq = parseInt(dbinfo_lines[5].substring(5));
    var length = parseInt(dbinfo_lines[6].substring(7));
    return {
        title: dbinfo_lines[3].substring(6),
        parts: dbinfo_lines[4].substring(7).trim().split(" "),
        num_seq: parseInt(dbinfo_lines[5].substring(5)),
        length: parseInt(dbinfo_lines[6].substring(7))
    };
}

module.exports.run = function(config, status) {

    console.log("osgblast workflow starting with following config");
    console.dir(config);

    /* config should look like
    {
        "project": "CSIU",
        "user": "hayashis",
        "rundir": "/local-scratch/hayashis/rundir/nt.2000"
        "input": "nt.5000.fasta",
        "db": "oasis:nt.1-22-2014",
        "blast": "blastn",
        "blast_opts": "-evalue 0.001 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0",
    }
    */

    var dbtokens = config.db.split(":");
    if(dbtokens[0] == "oasis") {
        //config._db_type = "oasis";
        //TODO - validate dbtokens[1] (don't allow path like "../../../../etc/passwd"
        config._db_oasispath = "/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/"+dbtokens[1];
        config._db_name = dbtokens[1].split(".")[0]; //nt.1-22-2014  >> nt
        var pdir = config._db_oasispath+"/"+config._db_name;
        //console.log("using dir:"+pdir);
        if(fs.existsSync(pdir+".pal")) {
            //config._db_type = "prot";
            config.dbinfo = load_db_info(pdir+".pal");
        } else if(fs.existsSync(pdir+".nal")) {
            //config._db_type = "nucl";
            config.dbinfo = load_db_info(pdir+".nal");
        } else {
            //single part db 
            config.dbinfo = {
                title: config._db_name, //TODO - pull real name from db?
                parts: [config._db_name]
            };
        }
    }

    /*
    process.on('SIGINT', function() {
        status("ABORTED", 'Workflow terminated by SIGINT');
    });
    process.on('SIGTERM', function() {
        status("ABORTED", 'Workflow terminated by SIGTERM');
    })
    */
    process.on('uncaughtException', function(err) {
        //TODO send this to GOC?
        console.error('Caught exception: ' + err);
    });

    var condor = {
        //needed to run jobs on osg-xsede
        "+ProjectName": config.project,
        "+PortalUser": config.user,

        "Requirements": "(GLIDEIN_ResourceName =!= \"cinvestav\") && "+     //cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)
                        "(GLIDEIN_ResourceName =!= \"Nebraska\") && "+      //oasis doesn't get refreshed
                        "(GLIDEIN_ResourceName =!= \"Sandhills\") && "+       //OASIS not setup right
                        //"(GLIDEIN_ResourceName =!= \"Crane\") && "+       
                        //"(GLIDEIN_ResourceName =!= \"Tusker\") && "+ //test routinely timeout on Tusker
                        "(HAS_CVMFS_oasis_opensciencegrid_org =?= True) && (CVMFS_oasis_opensciencegrid_org_REVISION >= 1687) && (Memory >= 2000) && (Disk >= 200*1024*1024)"
    }

    var workflow = new osg.Workflow();

    //set some extra attributes for our workflow
    workflow.test_job_num = 5; //number of jobs to submit for test
    workflow.test_job_count = 0; //number of jobs tested so far
    workflow.test_job_block_size = 50; //number of query to test
    workflow.target_job_duration = 1000*60*90; //shoot for 90 minutes
    workflow.block_size = 2000; //testrun will reset this based on execution time of test jobs (and resource usage in the future)

    //convert input query path to absolute path
    if(config.input[0] != "/") {
        config.input = config.rundir+"/"+config.input;
        console.log("using input path:"+config.input);
    }

    //start the workflow
    return  prepare_outputdir().
            then(load_test_fasta).
            then(create_test_jobs).
            then(run_test_jobs).
            then(split_input).
            then(queue_jobs);
    /*
        //start right away
        return split_input().then(queue_jobs);
    */

    function prepare_outputdir() {
        return new Promise(function(resolve, reject) {
            //prepare output directory
            console.log("cleanup output directory");
            rimraf(config.rundir+'/output', function() {
                //create output directory to store output
                fs.mkdir(config.rundir+'/output', function(err) {
                    if(err) {
                        console.log(err);
                        reject();
                    } else {
                        resolve();
                    }
                });
            });

        });
    }

    function submittest(fastas, part, done) {
        status('TESTING', 'Submitting test jobs part:'+part);

        var test_starttime = null;
        var resourcename = null; //name of site running

        var job = workflow.submit({
            executable: __dirname+'/blast.sh',
            receive: ['output'],
            timeout: 30*60*1000, //run test for max 30 minutes.. (test should end in 5 - 10 minutes)
            description: 'test blast job on dbpart:'+part+' with queries:'+fastas.length,
            condor: condor,

            debug: true,

            //use callback function to auto-generate rundir and let me put stuff to it
            rundir: function(rundir, done_prepare) {
                async.series([
                    //write out input query
                    function(next) {
                        var data = "";
                        fastas.forEach(function(fasta) {
                            data+=fasta+"\n";
                        });
                        fs.writeFile(rundir+'/test.fasta', data, next);
                    },
                    //write out input param file
                    function(next) {
                        fs.open(rundir+'/params.sh', 'w', function(err, fd) {
                            fs.writeSync(fd, "export inputquery=test.fasta\n");
                            fs.writeSync(fd, "export dbpath="+config._db_oasispath+"\n");
                            var dbpart = part;
                            if(config.dbinfo.parts.length <= part) {
                                //use first db part if we don't have enough db parts
                                dbpart = 0;
                            }
                            //console.log("#####################using db part:"+dbpart);
                            fs.writeSync(fd, "export dbname=\""+config.dbinfo.parts[dbpart]+"\"\n");
                            fs.writeSync(fd, "export blast="+config.blast+"\n");
                            if(config.dbinfo.length) {
                                fs.writeSync(fd, "export blast_dbsize=\"-dbsize "+config.dbinfo.length+"\"\n");
                            }
                            fs.writeSync(fd, "export blast_opts=\""+config.blast_opts+"\"\n");
                            fs.close(fd);
                            next();
                        });
                    }
                ], function(err) {
                    done_prepare();
                });
            }
        });

        job.on('submit', function(info) {
            console.log(job.id+' test:'+part+' submitted');
        });

        job.on('execute', function(info) {
            job.q(function(err, data) {
                resourcename = data.MATCH_EXP_JOBGLIDEIN_ResourceName + '/'+data.MachineAttrName0;
                console.log(job.id+ ' test:'+part+" started running on "+resourcename);
            });
            test_starttime  = new Date().getTime();
        });

        job.on('timeout', function() {
            status('FAILED', 'test job timed out on '+resourcename+' .. aborting');
            console.log("---------------------------stdout------------------------- "+job.stdout);
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log(data);
                fs.readFile(job.stderr, 'utf8', function (err,data) {
                    console.log("---------------------------stderr-------------------------"+job.stderr);
                    console.log(data);

                    workflow.removeall();
                    done('test timed out');
                }); 
            }); 
        });

        job.on('imagesize', function(info) {
            console.log(job.id+' test:'+part+' imagesize '+JSON.stringify(info));
        });

        job.on('exception', function(info) {
            //sometime exeption happens before execute event.. pull resource name so that I can
            //report where the error message happens
            job.q(function(err, data) {
                resourcename = data.MATCH_EXP_JOBGLIDEIN_ResourceName + '/'+data.MachineAttrName0;
                console.log(job.id+' test:'+part+' threw exception on '+resourcename+' :: '+info.Message);
            });
            //job with exception thrown will probably be resubmitted
            /*
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log(data);
                fs.readFile(job.stderr, 'utf8', function (err,data) {
                    console.log(data);
                    workflow.removeall();
                }); 
            }); 
            done('test exception');
            */
        });

        job.on('hold', function(info) {
            status('FAILED', 'test:'+part+' held on '+resourcename+' .. aborting due to: ' + JSON.stringify(info));
            console.dir(info);
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log(data);
                fs.readFile(job.stderr, 'utf8', function (err,data) {
                    console.log(data);
                    workflow.removeall();
                    done('test held');
                });
            });
        });

        job.on('evict', function(info) {
            console.log('job evicted');
            console.dir(info);
            /*
            console.dir(info);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 
            status('FAILED', 'Test job evicted on '+resourcename+'.. aborting');
            workflow.removeall(); //TODO - should I resubmit instead?
            done('test evicted');
            */
        });

        job.on('abort', function(info) {
            status('ABORTED', 'Job aborted');
            console.log("job aborted");
            workflow.removeall();
            done('test aborted');
        });

        job.on('terminate', function(info) {
            if(info.ret == 0) {
                workflow.test_job_count+=1;
                var duration = new Date().getTime() - test_starttime;

                fs.readFile(job.rundir+'/output', {encoding: 'utf8'},  function(err, data) {
                    if(err) {
                        status('FAILED', job.id+' test job failed to produce output');
                        done("test failed - can't read output");
                    } else {
                        status('TESTING', job.id+' successfully completed test job in '+duration+' msec :: finished:'+workflow.test_job_count+'/'+workflow.test_job_num);
                        //start copying output to output directory
                        fs.createReadStream(job.rundir+'/output')
                            .pipe(fs.createWriteStream(config.rundir+'/output/test_output.part_'+part));
                        console.log("----------------------------- test output ---------------------------------");
                        console.log(data);
                        console.log("---------------------------------------------------------------------------");
                        done(null, duration);
                    }
                });

                /*
                //head the output file for log
                //console.log("reading output for log");
                fs.open(job.rundir+"/output", 'r', function(err, fd) {
                    var buffer = new Buffer(2000);
                    fs.read(fd, buffer, 0, buffer.length, null, function(err, bytesRead, buffer) {
                        if(err) {
                            status('FAILED', job.id+' test job failed to produce output');
                            console.log("failed to open output");
                            fs.readFile(job.stdout, 'utf8', function (err,data) {
                                console.log(data);
                                fs.readFile(job.stderr, 'utf8', function (err,data) {
                                    console.log(data);
                                    workflow.removeall();
                                }); 
                            }); 
                        } else {
                            //var data = buffer.toString('utf8', 0, buffer.length);
                            console.log("----------------------------- test output ---------------------------------");
                            console.log(buffer.toString('utf8'));
                            console.log("---------------------------------------------------------------------------");
                            status('RUNNING', job.id+' test job completed in '+duration+' msec -- '+workflow.test_job_count+' of '+workflow.test_job_num);

                            fs.close(fd, function() {
                                done(null, duration);
                            });
                        }

                    });
                });
                */

            } else {
                status('FAILED', job.id+' test job failed on '+resourcename+' with code '+info.ret+' - aborting workflow');
                fs.readFile(job.stdout, 'utf8', function (err,data) {
                    console.log(data);
                    fs.readFile(job.stderr, 'utf8', function (err,data) {
                        console.log(data);
                        workflow.removeall();
                        done("test failed");
                    }); 
                }); 
            }
        });
    }

    function split_input() {
        status("RUNNING", "Splitting input "+config.input+" into blocks with "+workflow.block_size+" queries each");
        return new Promise(function(resolve, reject) {
            var file = readblock.open(config.input);
            var block = 0;
            async.whilst(
                function() {return file.hasmore(); },
                function(next) {
                    readfastas(file, workflow.block_size, function(fastas) {
                        var data = "";
                        fastas.forEach(function(fasta) {
                            data+=fasta+"\n";
                        });
                        fs.writeFile(config.rundir+'/input.qb_'+block+'.fasta', data, function(){
                            block++;
                            next();
                        });
                    }); 
                },
                function() {
                    console.log("done splitting data");
                    resolve(block);
                }
            );
        });
    }

    function submitjob(block, dbpart, submitted, success, resubmit, reject) {
        console.log("submitting job block:"+block+" dbpart:"+dbpart);

        var resourcename = null; //name of site running
        var _rundir = null; //_rundir for this particualar job (not config.rundir)

        var job = workflow.submit({
            executable: __dirname+'/blast.sh',
            receive: ['output'],
            //arguments: [],
            timeout: 3*60*60*1000, //kill job in 3 hours (job should finish in 1.5 hours)
            description: 'blast query block:'+block+' on dbpart:'+dbpart,

            debug: true,

            condor: condor,
            rundir: function(rundir, done_prepare) {
                _rundir = rundir;
                async.series([
                    //link input query
                    function(next) {
                        /*
                        fs.open(rundir+'/test.fasta', 'w', function(err, fd) {
                            fastas.forEach(function(fasta) {
                                fs.write(fd, fasta);
                                fs.write(fd, '\n');
                            });
                            fs.close(fd);
                            next();
                        });
                        */
                        fs.symlink(config.rundir+'/input.qb_'+block+'.fasta', rundir+'/input.fasta', next);
                    },
                    //write out input param file
                    function(next) {
                        fs.open(rundir+'/params.sh', 'w', function(err, fd) {
                            fs.writeSync(fd, "export inputquery=input.fasta\n");
                            fs.writeSync(fd, "export dbpath="+config._db_oasispath+"\n");
                            fs.writeSync(fd, "export dbname=\""+config.dbinfo.parts[dbpart]+"\"\n");
                            fs.writeSync(fd, "export blast="+config.blast+"\n");
                            if(config.dbinfo.length) {
                                fs.writeSync(fd, "export blast_dbsize=\"-dbsize "+config.dbinfo.length+"\"\n");
                            }
                            fs.writeSync(fd, "export blast_opts=\""+config.blast_opts+"\"\n");
                            fs.close(fd);
                            next();
                        });
                    }
                ], function(err) {
                    done_prepare();
                });
            }
        });

        job.on('submit', function(info) {
            console.log(job.id+" submitted");
            submitted(null); //null for err
        });

        job.on('timeout', function(info) {
            console.log(job.id+' timedout - resubmitting');

            //TODO - should I to hold & release instead?
            workflow.remove(job);
            resubmit(job, block, dbpart);
        });

        job.on('imagesize', function(info) {
            console.log(job.id+' qb:'+block+' db:'+dbpart+' imagesize update '+JSON.stringify(info));
        });

        job.on('hold', function(info) {
            var now = new Date();
            //TODO - report issue to goc?
            console.log("----------------------------------"+job.id+" held---------------------------------");
            console.dir(info);
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log("----------------------------------stdout------------------------------------------");
                console.log(data);
                fs.writeFile(config.rundir+'/held.stdout.'+block+'.'+dbpart+'.'+now.getTime(), data);
            }); 
            fs.readFile(job.stderr, 'utf8', function (err,data) {
                console.log("----------------------------------stderr------------------------------------------");
                console.log(data);
                fs.writeFile(config.rundir+'/held.stderr.'+block+'.'+dbpart+'.'+now.getTime(), data);
            }); 
            job.q(function(err, data) {
                if(job.JobRunCount < 3) {
                    console.log(job.id+" JobRunCount: "+job.JobRunCount+" ... releasing in 60 seconds");
                    setTimeout(function() {
                        workflow.release(job);
                    }, 60*1000);
                } else {
                    status('FAILED', 'Job:'+job.id+' ran too many times:'+job.job.JobRunCount+' .. aborting workflow. ');
                    workflow.removeall();
                    reject();
                }
            });
        });

        job.on('execute', function(info) {
            job.q(function(err, data) {
                resourcename = data.MATCH_EXP_JOBGLIDEIN_ResourceName + '/'+data.MachineAttrName0;
                console.log(job.id+' qb:'+block+' db:'+dbpart+' started running on '+resourcename+' rundir:'+_rundir);
            });
            test_starttime  = new Date().getTime();
        });

        job.on('exception', function(info) {
            //sometime exeption happens before execute event.. pull resource name so that I can
            //report where the error message happens
            job.q(function(err, data) {
                resourcename = data.MATCH_EXP_JOBGLIDEIN_ResourceName + '/'+data.MachineAttrName0;
                console.log(job.id+' qb:'+block+' db:'+dbpart+' exception on '+resourcename+' :: '+info.Message);
            });
            /* I don't ever get anything useful from these logs
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.stderr, 'utf8', function (err,data) {
                console.log(data);
            }); 
            */
            //exception event could be followed by hold event if it's totally screwed(really?)
            //hold callback will resubmit job
        });

        job.on('abort', function(info) {
            status('ABORTED', job.id+' qb:'+block+' db:'+dbpart+' job aborted.. stopping workflow');
            workflow.removeall();
            reject();
        });

        job.on('terminate', function(info) {
            if(info.ret == 0) {
                //start copying file to rundir
                fs.createReadStream(job.rundir+'/output')
                    .pipe(fs.createWriteStream(config.rundir+'/output/output.qb_'+block+'.db_'+dbpart));
                success(job);
            } else if(info.ret > 1 && info.ret < 10) {
                status('FAILED', job.id+' qb:'+block+' db:'+dbpart+' job permanently failed.. stopping workflow');

                var now = new Date();
                console.log("----------------------------------permanent error---------------------------------");
                fs.readFile(job.stdout, 'utf8', function (err,data) {
                    console.log("----------------------------------stdout------------------------------------------");
                    console.log(data);
                    fs.writeFile(config.rundir+'/terminated.stdout.qb_'+block+'.db_'+dbpart+'.'+now.getTime(), data);

                    fs.readFile(job.stderr, 'utf8', function (err,data) {
                        console.log("----------------------------------stderr------------------------------------------");
                        console.log(data);
                        fs.writeFile(config.rundir+'/terminated.stderr.qb_'+block+'.db_'+dbpart+'.'+now.getTime(), data);

                        workflow.removeall();
                        reject();
                    }); 
                }); 
            } else {
                status('RUNNING', job.id+' qb:'+block+' db:'+dbpart+' job failed with code '+info.ret+'.. resubmitting');
                resubmit(job, block, dbpart);
                fs.readFile(job.stdout, 'utf8', function (err,data) {
                    console.log("----------------------------------stdout------------------------------------------");
                    console.log(data);
                    fs.writeFile(config.rundir+'/terminated.stdout.qb_'+block+'.db_'+dbpart+'.'+now.getTime(), data);
                }); 
                fs.readFile(job.stderr, 'utf8', function (err,data) {
                    console.log("----------------------------------stderr------------------------------------------");
                    console.log(data);
                    fs.writeFile(config.rundir+'/terminated.stderr.qb_'+block+'.db_'+dbpart+'.'+now.getTime(), data);
                }); 
            }
        });
    }

    //load fasta blocks to test
    function load_test_fasta() {
        console.log("loading test fasta");
        var fasta_blocks = [];
        return new Promise(function(resolve, reject) {
            var file = readblock.open(config.input);
            var i = 0;
            async.whilst(
                function() { return i < workflow.test_job_num; },
                function(next) {
                    i++;
                    readfastas(file, workflow.test_job_block_size, function(fastas) {
                        if(fastas.length > 0) {
                            fasta_blocks.push(fastas);
                        }
                        next();
                    });
                },
                function() {resolve(fasta_blocks); }
            );
        });
    }

    //create as many jobs as there are fasta blocks
    function create_test_jobs(fasta_blocks) {
        console.log("creating test jobs with "+fasta_blocks.length);
        var test_jobs = [];
        return new Promise(function(resolve, reject) {
            function pushtestjob(i) {
                fastas = fasta_blocks[i];
                console.log("creating test job "+i +" using "+fastas.length+" fastas");
                test_jobs.push(function(done) {
                    submittest(fastas, i, done);
                });
            }
            for(var i in fasta_blocks) {
                pushtestjob(i);
            }
            resolve(test_jobs);
        });
    }

    function run_test_jobs(test_jobs) {
        return new Promise(function(resolve, reject) {
            async.parallel(test_jobs, function(err, results) {
                if(err) {
                    console.log("Test failed.. waiting all to end");
                    reject();
                } else {
                    console.log("results");
                    console.dir(results);

                    //calculate average time it took to run
                    var sum = results.reduce(function(psum,a) {return psum+a});
                    var average = sum / results.length; 

                    //calculate optimum query block size
                    workflow.block_size = parseInt(workflow.target_job_duration / average * workflow.test_job_block_size);
                    console.log("computed block size:" + workflow.block_size);

                    console.log("now off to running the main workflow");
                    resolve();
                }
            });
        });
    }

    //submit all jobs!
    function queue_jobs(blocks) {
        var jobnum = config.dbinfo.parts.length*blocks;
        var jobdone = 0;
        
        console.log("number of blocks:"+blocks+" number of db parts:"+config.dbinfo.parts.length);

        return new Promise(function(resolve, reject) {

            function success(job) {
                jobdone++;
                status('RUNNING', job.id+' successfully completed :: finished:'+jobdone+'/'+jobnum);

                //job completed?
                if(jobdone == jobnum) {
                    status('COMPLETED', 'all jobs successfully completed. total jobs:'+jobnum);
                    resolve();
                }
            }

            function resubmit(job, block, dbpart) {
                status('RUNNING', job.id+' re-submitting');
                //TODO - check retry count and abort workflow if it's too high
                //if(retrycount > 4) {
                //    reject()
                //} else {
                submitjob(block, dbpart, function() {}, success, resubmit, reject); 
            }


            //now submit
            var dbpart = 0;
            async.whilst(
                function() { return dbpart<config.dbinfo.parts.length; },
                function(next_dbpart) {
                    dbpart++;
                    var block = 0;
                    async.whilst(
                        function() { return block<blocks; },
                        function(next_block) {
                            block++;
                            submitjob(block-1, dbpart-1, next_block, success, resubmit, reject); 
                        },
                        function() {
                            next_dbpart();
                        }
                    );
                },
                function() {
                    staus("RUNNING", "submitted all jobs:"+jobnum);
                }
            );
        });
    }
};

