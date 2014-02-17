var fs = require('fs');

var osg = require('osg');
var readblock = require('readblock');
var temp = require('temp');
var Promise = require('promise');
var merge = require('merge');
var async = require('async');
var path = require('path');

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

module.exports.run = function(config) {
    if(!config) {
        //load config.json from cwd()
        var config = require(process.cwd()+'/config');
    }

    //console.log("osg-blast running");
    //console.dir(config);
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

    //create output directory to store output
    fs.mkdir('output', function(err) {
        if(err) {
            console.log(err);
        }
    });

    /*
    var config = {
        project: 'CSIU',
        user: 'hayashis', //username to report to osg-xsede (usually the real submitter of the job)
        input: 'test/nt.20000.fasta',
        dbtype: 'oasis',
        dbname: 'nt.1-22-2014',
        dbparts: [
            'nt.00', 'nt.01', 'nt.02', 'nt.03', 'nt.04', 'nt.05', 'nt.06', 'nt.07', 'nt.08', 'nt.09', 
            'nt.10', 'nt.11', 'nt.12', 'nt.13', 'nt.14', 'nt.15', 'nt.16' ],
        blast: 'blastn',
        blast_opts: '-evalue 0.001 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0'
    };
    */

    var condor = {
        //needed to run jobs on osg-xsede
        "+ProjectName": config.project,
        "+PortalUser": config.user,

        "Requirements": "(GLIDEIN_ResourceName =!= \"cinvestav\") && "+     //cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)
                        "(GLIDEIN_ResourceName =!= \"Nebraska\") && "+      //oasis doesn't get refreshed
                        //"(GLIDEIN_ResourceName =!= \"SPRACE\") && "+        //SPRACE doesn't update oasis (goc ticket 19587)
                        "(GLIDEIN_ResourceName =!= \"Sandhills\") && "+       
                        "(GLIDEIN_ResourceName =!= \"Crane\") && "+       
                        "(HAS_CVMFS_oasis_opensciencegrid_org =?= True) && (Memory >= 2000) && (Disk >= 500*1024*1024)"
    }

    var workflow = {
        test_job_num: 5, //number of jobs to submit for test
        test_job_count: 0, //number of jobs tested so far
        test_job_block_size: 50, //number of query to test
        target_job_duration: 1000*60*90, //shoot for 90 minutes
        block_size: 1000, //testrun will reset this based on execution time of test jobs (and resource usage in the future)
    }

    //start the workflow
    return  load_test_fasta().
            then(create_test_jobs).
            then(run_test_jobs).
            then(split_input).
            then(queue_jobs);

    function submittest(fastas, part, done) {
        status('RUNNING', 'Submitting test jobs using db part '+part);

        var test_starttime = null;
        var test_endtime = null;
        var resourcename = null; //name of site running

        var events = osg.submit({
            executable: __dirname+'/blast.sh',
            /*
            arguments: ['test.fasta',  //input query
                '/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/'+config.dbname, //name of db to use
                partname], //dbpart to run (nt.00)
            */
            timeout: 20*60*1000, //call timeout in 20 minutes 
            /*
            condor: merge({
                'periodic_hold': '( ( CurrentTime - EnteredCurrentStatus ) > 14400) && JobStatus == 2'
            }, condor) //some common condor options we need to pass
            */
            description: 'test blast job on dbpart:'+part+' with queries:'+fastas.length,
            condor: condor,
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
                            fs.writeSync(fd, "export dbpath=/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/"+config.dbname+"\n");
                            fs.writeSync(fd, "export dbname=\""+config.dbparts[part]+"\"\n");
                            fs.writeSync(fd, "export blast="+config.blast+"\n");
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
            osg.removeall();
            done('test timeout');
        });

        events.on('progress', function(job, info) {
            console.log('progress on db_part:'+part+' '+JSON.stringify(info));
        });

        events.on('exception', function(job, info) {
            status('FAILED', 'Test job failed on '+resourcename+' .. aborting :: '+info.Message);
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
            //osg.removeall();
            //TODO - should I resubmit instead?
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
                }); 
                fs.readFile(job.options.error, 'utf8', function (err,data) {
                    console.log(data);
                }); 
                osg.removeall();
                done('test failed with '+info.ret);
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
                            fs.writeSync(fd, "export dbpath=/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/"+config.dbname+"\n");
                            fs.writeSync(fd, "export dbname=\""+config.dbparts[dbpart]+"\"\n");
                            fs.writeSync(fd, "export blast="+config.blast+"\n");
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
            submitted(); //don't pass anything or get canceled
        });

        events.on('timeout', function(job, info) {
            console.log(job.id+' timedout - resubmitting');
            //TODO increment resubmit counter?
            resubmit(job, block, dbpart);
        });

        events.on('progress', function(job, info) {
            //TODO - anything we need to do?
            //console.log('progress on db_part:'+part+' query_block:'+block + JSON.stringify(info));
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
            status('FAILED', 'Job failed on '+resourcename+' .. aborting :: '+info.Message);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 
            osg.removeall();
            done('test exception');
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
                resubmit(job, block, dbpart);
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

    //submit jobs!
    function queue_jobs(blocks) {
        var jobsubmitted = 0;
        var jobdone = 0;
        
        console.log("number of blocks:"+blocks);
        console.log("number of dbparts:"+config.dbparts.length);

        //submit all jobs
        return new Promise(function(resolve, reject) {

            function success(job) {
                jobdone++;
                status('RUNNING', 'job:'+job.id+' successfully completed:: finished:'+jobdone+'/'+jobsubmitted+' running:'+osg.running);
                //job completed?
                if(jobdone == jobsubmitted) {
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

            var dbpart = 0;
            async.whilst(
                function() { return dbpart<config.dbparts.length; },
                function(next_dbpart) {
                    dbpart++;
                    var block = 0;
                    async.whilst(
                        function() { return block<blocks; },
                        function(next_block) {
                            block++;
                            submitjob(block-1, dbpart-1, next_block, success, resubmit); 
                            jobsubmitted++;
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
    }
};


