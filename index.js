var fs = require('fs');

var osg = require('osg');
var readblock = require('readblock');
var temp = require('temp');
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

//write out the main status file
//status could be one of following
//RUNNING / FAILED / KILLED / FINISHED
function status(status, message) {
    fs.writeFile("status.txt", status+"\n"+message+"\n");
    var d = new Date();
    console.log(status + " :: " + d.toString() + " :: " + message);
}

function padDigits(number, digits) {
    return Array(Math.max(digits - String(number).length + 1, 0)).join(0) + number;
}

/* parses content that looks like..
#
# Alias file created 12/13/2013 08:36:19
#
TITLE Nucleotide collection (nt)
DBLIST                  nt.00 nt.01 nt.02 nt.03 nt.04 nt.05 nt.06 nt.07 nt.08 nt.09 nt.10 nt.11 nt.12 nt.13 nt.14 nt.15 nt.16
NSEQ 20909183
LENGTH 52564451792
*/
function load_db_info(dbinfo_path) {
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

module.exports.run = function(config) {
    /* config should look like
    {
        "project": "CSIU",
        "user": "hayashis",
        "input": "nt.5000.fasta",

        "db": "oasis:nt.1-22-2014",

        //"db_type": "oasis",
        //"db_path": "/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/nt.1-22-2014",
        //"dbinfo_path": "/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/nt.1-22-2014/nt.nal",

        "blast": "blastn",
        "blast_opts": "-evalue 0.001 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0"
    }
    */

    if(!config) {
        //load config.json from cwd()
        var config = require(process.cwd()+'/config');
    }

    var dbtokens = config.db.split(":");
    if(dbtokens[0] == "oasis") {
        //config._db_type = "oasis";
        //TODO - validate dbtokens[1] (don't allow path like "../../../../etc/passwd"
        config._db_oasispath = "/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/"+dbtokens[1];
        config._db_name = dbtokens[1].split(".")[0]; //nt.1-22-2014  >> nt
        var pdir = config._db_oasispath+"/"+config._db_name;
        console.log("using dir:"+pdir);
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

    //load dbinfo
    console.log("loaded dbinfo");
    console.dir(config);

    console.log("osg-blast running at "+process.cwd());

    /*
    process.on('SIGINT', function() {
        status("KILLED", 'Workflow terminated by SIGINT');
    });
    process.on('SIGTERM', function() {
        status("KILLED", 'Workflow terminated by SIGTERM');
    })
    */
    process.on('uncaughtException', function(err) {
        console.error('Caught exception: ' + err);
    });

    //write out the pid file
    fs.writeFile("pid.txt", process.pid.toString());

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

    var workflow = {
        test_job_num: 5, //number of jobs to submit for test
        test_job_count: 0, //number of jobs tested so far
        test_job_block_size: 50, //number of query to test
        target_job_duration: 1000*60*90, //shoot for 90 minutes
        block_size: 2000, //testrun will reset this based on execution time of test jobs (and resource usage in the future)
    }

    //start the workflow
    return  load_test_fasta().
            then(create_test_jobs).
            then(run_test_jobs).
            then(split_input).
            then(queue_jobs);
    /*
        //start right away
        return split_input().then(queue_jobs);
    */


    function submittest(fastas, part, done) {
        status('RUNNING', 'Submitting test jobs using db part '+part);

        var test_starttime = null;
        var test_endtime = null;
        var resourcename = null; //name of site running

        var events = osg.submit({
            executable: __dirname+'/blast.sh',
            timeout: 30*60*1000, //30 minutes
            description: 'test blast job on dbpart:'+part+' with queries:'+fastas.length,
            condor: condor,

            //use callback function to auto-generate rundir and let me put stuff to it
            rundir: function(rundir, done_prepare) {
                async.series([
                    //write out input query
                    function(next) {
                        fs.open(rundir+'/test.fasta', 'w', function(err, fd) {
                            fastas.forEach(function(fasta) {
                                fs.write(fd, fasta);
                                fs.write(fd, '\n');
                            });
                            fs.close(fd);
                            next();
                        });
                    },
                    //write out input param file
                    function(next) {
                        fs.open(rundir+'/params.sh', 'w', function(err, fd) {
                            fs.writeSync(fd, "export inputquery=test.fasta\n");
                            fs.writeSync(fd, "export dbpath="+config._db_oasispath+"\n");
                            fs.writeSync(fd, "export dbname=\""+config.dbinfo.parts[part]+"\"\n");
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

        events.on('submit', function(job, info) {
        });

        events.on('execute', function(job, info) {
            osg.q(job).then(function(data) {
                //console.dir(data);
                //console.log("running on "+data.MATCH_EXP_JOB_Site); //TODO - is this the right attribute to use?
                console.log("test job running on "+data.MATCH_EXP_JOBGLIDEIN_ResourceName);
                resourcename = data.MATCH_EXP_JOBGLIDEIN_ResourceName;
            });
            test_starttime  = new Date().getTime();
        });

        events.on('timeout', function(job) {
            status('FAILED', 'Test job timed out on '+resourcename+' .. aborting');
            console.log("---------------------------stdout-------------------------");
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
                fs.readFile(job.options.error, 'utf8', function (err,data) {
                    console.log("---------------------------stderr-------------------------");
                    console.log(data);
                    osg.removeall();
                }); 
            }); 
        });

        events.on('progress', function(job, info) {
            console.log('progress on db_part:'+part+' '+JSON.stringify(info));
        });

        events.on('exception', function(job, info) {
            status('FAILED', 'Test job threw exception on '+resourcename+' .. aborting :: '+info.Message);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 
            osg.removeall();
            done('test exception');
        });

        events.on('hold', function(job, info) {
            status('FAILED', 'Test job held on '+resourcename+' .. aborting');
            console.dir(job);
            /*
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 
            */
            osg.removeall();
            done('test held');
        });

        events.on('evict', function(job, info) {
            status('FAILED', 'Test job evicted on '+resourcename+'.. aborting');
            /*
            console.dir(info);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 
            */
            //TODO - should I resubmit instead?
            osg.removeall();
            done('test evicted');
        });

        events.on('abort', function(job, info) {
            console.log("job aborted");
            done('test aborted');
        });

        events.on('terminate', function(job, info) {
            //console.dir(info);
            if(info.ret == 0) {
                workflow.test_job_count+=1;
                status('RUNNING', 'Test job completed '+workflow.test_job_count+' of '+workflow.test_job_num);
                var duration = new Date().getTime() - test_starttime;
                done(null, duration);
                /*
                fs.readFile(job.options.output, 'utf8', function (err,data) {
                    console.log(data);
                }); 
                */
                fs.readFile(info.rundir+"/output", 'utf8', function(err, data) {
                    if(err) {
                        console.log("failed to open output");
                    } else {
                        console.log(data.substring(0, 500));
                    }
                });
            } else {
                status('FAILED', 'Test failed on '+resourcename+' with code '+info.ret+' - aborting');
                fs.readFile(job.options.output, 'utf8', function (err,data) {
                    console.log(data);
                    fs.readFile(job.options.error, 'utf8', function (err,data) {
                        console.log(data);

                        osg.removeall();
                        done('test failed with '+info.ret);
                    }); 
                }); 
            }
        });
    }

    /*
    function runworkflow(part) {
        console.log("running workflow now");
        console.dir(workflow);

        var jobs = [];

        var file = readblock.open(config.input);
        function loadfasta(block, next) {
            //console.log("loading fasta");
            readfastas(file, workflow.block_size, function(fastas) {
                fs.writeData(
                //console.log("loaded "+fastas.length+" fastas as block:"+block+" for dbpart:"+part);
                jobs.push(function(jobdone) {
                    runjob(fastas, block, part, jobdone);
                });
                next();
            });
        }

        var block = 0;
        async.whilst(
            function() {return block < ; },
            function(next) {
                loadfasta(block++, next);
            },
            function() {
                console.log("loaded "+jobs.length+" jobs for dbpart:"+part);
                async.parallelLimit(jobs, 5, function() {
                    status('RUNNING', 'Done with all jobs for dbpart:'+part);
                });
            }
        );
    }
    */

    function split_input() {
        status("RUNNING", "Splitting input "+config.input+" into "+workflow.block_size+" query each");
        return new Promise(function(resolve, reject) {
            var file = readblock.open(config.input);
            var block = 0;
            async.whilst(
                function() {return file.hasmore(); },
                function(next) {
                    readfastas(file, workflow.block_size, function(fastas) {
                        //var bnum = padDigits(block, 2);
                        fs.open('input.'+block+'.fasta', 'w', function(err, fd) {
                            fastas.forEach(function(fasta) {
                                fs.writeSync(fd, fasta+"\n");
                            });
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

    function submitjob(block, dbpart, submitted, success, resubmit) {
        console.log("submitting job block:"+block+" dbpart:"+dbpart);
        var resourcename = null; //name of site running
        var events = osg.submit({
            executable: __dirname+'/blast.sh',
            //arguments: [],
            timeout: 3*60*60*1000, //kill job in 3 hours (job should finish in 1.5 hours)
            description: 'blast on dbpart:'+dbpart+' with querie block:'+block,
            condor: condor,
            rundir: function(rundir, done_prepare) {
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
                        fs.symlink(path.resolve('input.'+block+'.fasta'), rundir+'/input.fasta', next);
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

        events.on('submit', function(job) {
            console.log(job.id+" submitted");
            submitted(null); //null for err
        });

        events.on('timeout', function(job, info) {
            console.log(job.id+' timedout - resubmitting');
            //TODO - should I to hold & release instead?
            osg.remove(job);
            resubmit(job, block, dbpart);
        });

        events.on('progress', function(job, info) {
            console.log('progress on db_part:'+dbpart+' query_block:'+block + JSON.stringify(info));
        });

        events.on('hold', function(job, info) {
            var now = new Date();
            //TODO - report issue to goc?
            console.log("----------------------------------"+job.id+" held---------------------------------");
            console.dir(info);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log("----------------------------------stdout------------------------------------------");
                console.log(data);
                fs.writeFile('held.stdout.'+block+'.'+dbpart+'.'+now.getTime(), data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log("----------------------------------stderr------------------------------------------");
                console.log(data);
                fs.writeFile('held.stderr.'+block+'.'+dbpart+'.'+now.getTime(), data);
            }); 
            osg.q(job).then(function(data) {
                if(job.JobRunCount < 3) {
                    console.log("releasing job:"+job.id);
                    osg.release(job);
                } else {
                    status('FAILED', 'Job:'+job.id+' held too many times.. aborting workflow. ');
                    osg.removeall();
                }
            });
        });

        events.on('execute', function(job, info) {
            console.log(job.id+' running db_part:'+dbpart+' query_block:'+block);
            /*
            status('RUNNING', 'Running db_part:'+part+' query_block:'+block);
            osg.q(job).then(function(data) {
                console.log('running db_part:'+part+' query_block:'+block+' on '+data.MATCH_EXP_JOBGLIDEIN_ResourceName);
                resourcename = data.MATCH_EXP_JOBGLIDEIN_ResourceName;
            });
            test_starttime  = new Date().getTime();
            */
        });

        events.on('exception', function(job, info) {
            /*
            status('FAILED', 'Job failed on '+resourcename+' .. aborting :: '+info.Message);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 
            osg.removeall();
            done('test exception');
            */
            console.log(job.id+" exception (resubmitting) "+resourcename);
            console.dir(info);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 
            //usually, exception event will be followed by hold event, but I don't think it's 100%
         });

        events.on('abort', function(job, info) {
            status('FAILED', 'Job aborted on '+job.id+'.. aborting workflow');
            osg.removeall();
        });

        events.on('terminate', function(job, info) {
            if(info.ret == 0) {
                //copy file to rundir
                fs.createReadStream(info.rundir+'/output').pipe(fs.createWriteStream('output/output.'+block+'.'+dbpart));
                success(job);
            } else if(info.ret > 1 && info.ret < 10) {
                status('FAILED', 'Job permanently failed on '+job.id+' aborting workflow');
                osg.removeall();

                var now = new Date();
                console.log("----------------------------------permanent error---------------------------------");
                fs.readFile(job.options.output, 'utf8', function (err,data) {
                    console.log("----------------------------------stdout------------------------------------------");
                    console.log(data);
                    fs.writeFile('terminated.stdout.'+block+'.'+dbpart+'.'+now.getTime(), data);
                }); 
                fs.readFile(job.options.error, 'utf8', function (err,data) {
                    console.log("----------------------------------stderr------------------------------------------");
                    console.log(data);
                    fs.writeFile('terminated.stderr.'+block+'.'+dbpart+'.'+now.getTime(), data);
                }); 
            } else {
                console.log("job terminated with code "+info.ret+" resubmitting");
                resubmit(job, block, dbpart);
                fs.readFile(job.options.output, 'utf8', function (err,data) {
                    console.log("----------------------------------stdout------------------------------------------");
                    console.log(data);
                    fs.writeFile('terminated.stdout.'+block+'.'+dbpart+'.'+now.getTime(), data);
                }); 
                fs.readFile(job.options.error, 'utf8', function (err,data) {
                    console.log("----------------------------------stderr------------------------------------------");
                    console.log(data);
                    fs.writeFile('terminated.stderr.'+block+'.'+dbpart+'.'+now.getTime(), data);
                }); 
            }
        });
    }

    //load fasta blocks to test
    function load_test_fasta() {
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
        var test_jobs = [];
        console.log("creating test jobs with "+fasta_blocks.length);
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
        
        console.log("number of blocks:"+blocks);
        console.log("number of db parts:"+config.dbinfo.parts.length);

        return new Promise(function(resolve, reject) {

            function success(job) {
                jobdone++;
                status('RUNNING', 'job:'+job.id+' successfully completed:: finished:'+jobdone+'/'+jobnum);
                //job completed?
                if(jobdone == jobnum) {
                    resolve();
                }
            }

            function resubmit(job, block, dbpart) {
                console.log(job.id+' re-submitting');
                //TODO - check retry count and abort workflow if it's too high
                //if(retrycount > 4) {
                //    reject()
                //} else {
                submitjob(block, dbpart, function() {}, success, resubmit); 
            }

            //prepare output directory
            console.log("cleanup output directory");
            rimraf('output', function() {
                //create output directory to store output
                fs.mkdir('output', function(err) {
                    if(err) {
                        console.log(err);
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
                                    submitjob(block-1, dbpart-1, next_block, success, resubmit); 
                                },
                                function() {
                                    next_dbpart();
                                }
                            );
                        },
                        function() {
                            console.log("submitted all jobs");
                        }
                    );

                });
            });

        });
    }
};


