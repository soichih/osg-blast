var http = require('http');
var fs = require('fs');
var extend = require('util')._extend;

var osg = require('osg');
var readblock = require('readblock');
var Q = require('q');
var merge = require('merge');
var async = require('async');
var path = require('path');
var rimraf = require('rimraf');
var which = require('which');

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

function load_db_info(data) {
    /* parses content that looks like..
    #
    # Alias file created 12/13/2013 08:36:19
    #
    TITLE Nucleotide collection (nt)
    DBLIST                  nt.00 nt.01 nt.02 nt.03 nt.04 nt.05 nt.06 nt.07 nt.08 nt.09 nt.10 nt.11 nt.12 nt.13 nt.14 nt.15 nt.16
    NSEQ 20909183
    LENGTH 52564451792
    */
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

var workflow_registry = {
    workflows: [], //list of all workflows
    remove: function(workflow) {
        workflow.remove();
        var i = this.workflows.indexOf(workflow);
        if(~i) {
            console.log("removing workflow "+i);
            this.workflows.splice(i, 1);
        }
    },
    create: function() {
        var workflow = new osg.Workflow();
        this.workflows.push(workflow);
        return workflow;
    },
    removeall: function() {
        this.workflows.forEach(function(workflow) {
            console.log("removing workflow "+workflow.id);
            workflow.remove();
        });
        this.workflows = []; //empty it
    }
};

module.exports.stop = function() {
    workflow_registry.removeall();
};

module.exports.run = function(config, status) {
    //some default
    config = extend({
        tmpdir: '/tmp',
        x509userproxy: '/local-scratch/iugalaxy/blastcert/osgblast.proxy'
    }, config); 

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

    var condor = {
        //needed to run jobs on osg-xsede
        "+ProjectName": config.project,
        "+PortalUser": config.user,


        //TODO - untested -- is this really a good idea?
        "periodic_remove": "(CurrentTime - EnteredCurrentStatus) > 14400", //remove jobs stuck for 4 hours

        "Requirements": "(GLIDEIN_ResourceName =!= \"cinvestav\") && "+     //cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)
                        "(GLIDEIN_ResourceName =!= \"NWICG_NDCMS\") && "+      //code 3-ed left and right for irods
                        //"(GLIDEIN_ResourceName =!= \"Nebraska\") && "+      //oasis doesn't get refreshed (works if I specify revision)
                        //"(GLIDEIN_ResourceName =!= \"Sandhills\") && "+       //OASIS not setup right (works if I specify revision)
                        //"(GLIDEIN_ResourceName =!= \"Crane\") && "+       
                        //"(GLIDEIN_ResourceName =!= \"Tusker\") && "+ //test routinely timeout on Tusker
                
                        //This gets set automatically
                        //"(TARGET.Memory >=  ifthenelse(MemoryUsage isnt undefined,MemoryUsage,1967)) && "+

                        "(TARGET.Disk >= 10*1024*1024)" //10G should be more than enough enough
    }

    var workflow = workflow_registry.create();

    //output operational log (if config.oplog is set)
    function oplog(log) {
        if(config.oplog) {
            log.date =  new Date();
            try {
                var str = JSON.stringify(log, null, 4);
                fs.appendFile(config.oplog, str+"\n",  function (err) {
                    if(err) {
                        console.log("failed to output oplog:"+config.oplog+"\n"+err);
                    }
                });
            } catch (e) {
                console.log("oplog: couldn't stringify. dumping to console");
                console.dir(log);
            }
        }
    }

    function load_dbinfo(res, next) {
        var deferred = Q.defer();

        var dbtokens = config.db.split(":");
        if(dbtokens[0] == "oasis") {
            //add oasis requirements for condor Requirements
            //condor.Requirements = "(HAS_CVMFS_oasis_opensciencegrid_org =?= True) && (CVMFS_oasis_opensciencegrid_org_REVISION >= 1787) && "+condor.Requirements;
            condor.Requirements = "(TARGET.CVMFS_oasis_opensciencegrid_org_REVISION >= 1787) && "+condor.Requirements;

            console.log("processing oasis dbinfo");
            //TODO - validate dbtokens[1] (don't allow path like "../../../../etc/passwd"

            var oasis_dbpath = "/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/"+dbtokens[1];
            config._oasis_dbpath = oasis_dbpath;

            config._db_name = dbtokens[1].split(".")[0]; //nt.1-22-2014  >> nt
            var pdir = oasis_dbpath+"/"+config._db_name;
            status('TESTING', "loading dbinfo from oasisdb:"+pdir);
            if(fs.existsSync(pdir+".pal")) {
                var data = fs.readFileSync(pdir+".pal", {encoding: 'utf8'});
                config.dbinfo = load_db_info(data);
            } else if(fs.existsSync(pdir+".nal")) {
                var data = fs.readFileSync(pdir+".nal", {encoding: 'utf8'});
                config.dbinfo = load_db_info(data);
            } else {
                //single part db 
                config.dbinfo = {
                    title: config._db_name, //TODO - pull real name from db?
                    parts: [config._db_name]
                };
            }
            status('TESTING', "oasis dbinfo loaded");
            deferred.resolve(); 
        } else if(dbtokens[0] == "irods") {
            //we use irods binary stored in oasis.
            condor.Requirements = "(HAS_CVMFS_oasis_opensciencegrid_org =?= True) && "+condor.Requirements;
            //we need to use osg-blast/osg-xsede.grid.iu.edu service cert
            //condor.x509userproxy = "/local-scratch/iugalaxy/blastcert/osgblast.proxy"; // blastcert/proxy_init.sh
            condor.x509userproxy = path.resolve(config.x509userproxy);

            console.log("processing irods dbinfo");
            config._irod_dbpath = "irodse://goc@irods.fnal.gov:1247?/osg/home/goc/"+dbtokens[1];

            config._db_name = dbtokens[1].split(".")[0]; //nt.1-22-2014  >> nt
            var pdir = "/local-scratch/iugalaxy/blastdb/"+dbtokens[1]+"/"+config._db_name;
            status('TESTING', "loading dbinfo from "+pdir);
            if(fs.existsSync(pdir+".pal")) {
                var data = fs.readFileSync(pdir+".pal", {encoding: 'utf8'});
                config.dbinfo = load_db_info(data);
            } else if(fs.existsSync(pdir+".nal")) {
                var data = fs.readFileSync(pdir+".nal", {encoding: 'utf8'});
                config.dbinfo = load_db_info(data);
            } else {
                //single part db 
                config.dbinfo = {
                    title: config._db_name, //TODO - pull real name from db?
                    parts: [config._db_name]
                };
            }
            status('TESTING', "irods dbinfo loaded");
            console.dir(config.dbinfo);
            deferred.resolve(); 
        } else {
            status('TESTING', "processing user dbinfo");
            //assume http or ftp partial url (http://osg-xsede.grid.iu.edu/scratch/hayashis/userdb/11c2c67532d678042b684c52f888e7bd:sts)
            config._db_name = dbtokens.pop(); //grab last 
            config._user_dbpath = dbtokens.join(":");

            console.log("outputting user db config again");
            console.dir(config);

            //try downloading pal
            var apath = config._user_dbpath+"/"+config._db_name;
            console.log("trying to download "+apath+".pal");
            http_get(apath+".pal", function(err, data) {
                if(data) {
                    config.dbinfo = load_db_info(data);
                    deferred.resolve(); 
                } else {
                    console.log("trying to download "+apath+".nal");
                    http_get(apath+".nal", function(err, data) {
                        if(data) {
                            config.dbinfo = load_db_info(data);
                            deferred.resolve(); 
                        } else {
                            console.log("it must be a single db");
                            //single part db
                            config.dbinfo = {
                                title: config._db_name, //TODO - pull real name from db somehow?
                                parts: [config._db_name]
                            };
                            deferred.resolve(); 
                        }
                    });

                }
            });
        }
        return deferred.promise;
    }

    function http_get(url, next) {
        http.get(url, function(res) {
            if(res.statusCode == "200") {
                var data = "";
                res.on('data', function(chunk) {
                    data += chunk;
                });
                res.on('end', function() {
                    next(null, data);
                });
            } else {
                next(res.statusCode);
            }
        });
    }
    
    //start the workflow
    return  prepare().
            then(load_dbinfo).
            then(load_test_fasta).
            then(submit_tests).
            then(split_input).
            then(submit_jobs);

    function prepare() {
        //set some extra attributes for our workflow
        workflow.test_resubmits = 10; //max number of time test job should be resubmitted
        workflow.test_job_num = 5; //number of jobs to submit for test
        workflow.test_job_block_size = 32; //number of query to test per job
        workflow.target_job_duration = 1000*60*60; //shoot for 60 minutes

        //testrun will reset this based on execution time of test jobs (and resource usage in the future)
        workflow.block_size = 2000; 

        //convert input query path to absolute path
        if(config.input[0] != "/") {
            config.input = config.rundir+"/"+config.input;
            console.log("using input path:"+config.input);
        }

        //let user override the test block size (for really slow queries)
        if(config.test_job_block_size) {
            console.log("Setting test_job_block_size:"+config.test_job_block_size);
            workflow.test_job_block_size = config.test_job_block_size;
        }

        var deferred = Q.defer();
        async.series([
            function(next) {
                if(!fs.existsSync(config.input)) {
                    status('FAILED', "Can't find intput file:"+config.input);
                    deferred.reject();
                } else {
                    next();
                }
            },
            function(next) {
                //prepare output directory
                console.log("cleanup output directory");
                rimraf(config.rundir+'/output', function() {
                    //create output directory to store output
                    fs.mkdir(config.rundir+'/output', function(err) {
                        if(err) {
                            console.log(err);
                            deferred.reject();
                        } else {
                            next();
                        }
                    });
                });
            }
        ], deferred.resolve);
        return deferred.promise;
    }

    function submittest(fastas, part, submitted, success, resubmit, stopwf) {
        var job = workflow.submit({
            executable: __dirname+'/blast.sh',
            receive: ['output'],
            timeout: 40*60*1000, 
            timeout_reason: "test job timeout in 40 minutes", 

            description: 'test blast job on dbpart:'+part+' with queries:'+fastas.length,
            condor: condor,

            debug: config.debug,
            tmpdir: config.tmpdir,

            //use callback function to auto-generate rundir and let me put stuff to it
            rundir: function(rundir, done_prepare) {
                async.series([
                    //send blast binary to run
                    function(next) {
                        which(config.blast, function(err, path) {
                            if(err) {
                                stopwf('FAILED', "can't find blast executable:"+config.blast);
                                oplog({job: job, part: part, msg: "can't find blast executable:"+config.blast});
                            } else {
                                //console.log("found path:"+path);
                                //console.log("config.blast:"+config.blast);
                                fs.symlink(path, rundir+'/'+config.blast, next);
                            }
                        });
                    },
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
                            if(config._oasis_dbpath) {
                                fs.writeSync(fd, "export oasis_dbpath="+config._oasis_dbpath+"\n");
                            }
                            if(config._irod_dbpath) {
                                fs.writeSync(fd, "export irod_dbpath="+config._irod_dbpath+"\n");
                            }
                            if(config._user_dbpath) {
                                fs.writeSync(fd, "export user_dbpath="+config._user_dbpath+"\n");
                            }
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
            job._fastas = fastas;
            job._part = part;

            status("TESTING", job.id+" submitted test job part:"+part);
            if(submitted) {
                submitted();
            }
        });

        job.on('submitfail', function(err) {
            stopwf('FAILED', 'test job submission failed'+err);
            oplog({job: job, part: part, msg: "test job submission failed", err:err});
        });

        job.on('execute', function(info) {
            console.log(job.id+" :: test job part:"+part+" executing");
        });
        job.on('q', function(info) {
            status(null, job.id+" :: test job part:"+part+" running on "+job.resource_name);
        });

        /*
        job.on('timeout', function() {
            console.log("---------------------------stdout------------------------- "+job.stdout);
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log(data);
                fs.readFile(job.stderr, 'utf8', function (err,data) {
                    console.log("---------------------------stderr-------------------------"+job.stderr);
                    console.log(data);

                    stopwf('FAILED', 'test job timed out on '+job.resource_name+'.. aborting');
                }); 
            }); 
        });
        */

        job.on('imagesize', function(info) {
            console.log(job.id+' test:'+part+' imagesize '+JSON.stringify(info));
        });

        job.on('exception', function(info) {
            console.log(job.id+' test:'+part+' threw exception on '+job.resource_name+' :: '+info.Message);
            oplog({job: job, part: part, message: "exception: "+info.Message});
            /*
            if(config.opissue_log) {
                fs.appendFile(config.opissue_log, job.id+' test:'+part+' exception on '+job.resource_name+' :: '+info.Message+"\n");
            }
            */
        });

        job.on('hold', function(info) {
            console.dir(info);
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log(data);
                fs.readFile(job.stderr, 'utf8', function (err,data) {
                    console.log(data);
                    stopwf('FAILED', 'test:'+part+' held on '+job.resource_name+' .. aborting due to: ' + JSON.stringify(info));
                    oplog({job: job, part: part, msg: "test job held: " + info.msg, info: info.info});
                });
            });
        });

        job.on('evict', function(info) {
            //I am not sure if I've ever seen this happen
            console.log(job.id+' test:'+part+' evicted while running on '+job.resource_name);
            console.dir(info);
            //TODO - I believe evict events are followed by abort/terminate type event.. so I don't have to do anythig here?
        });

        job.on('abort', function(info) {
            stopwf('ABORTED', 'test job aborted');
        });

        job.on('terminate', function(info) {
            var name = 'test_'+part;
            terminated(job, info, name, success, resubmit, stopwf);
        });
    }

    //handles both test and real jobs
    function terminated(job, info, name, success, resubmit, stopwf) {
        var now = new Date();
        if(info.ret == 0) {
            //start copying file to rundir
            fs.createReadStream(job.rundir+'/output').pipe(fs.createWriteStream(config.rundir+'/output/output.'+name));
            success(job, info);
/*
        } else if(info.ret > 0 && info.ret < 10) {
            console.log("----------------------------------permanent error---------------------------------");
            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log("----------------------------------stdout------------------------------------------");
                console.log(data);
                fs.writeFile(config.rundir+'/terminated.stdout.'+name+'.'+now.getTime(), data);

                fs.readFile(job.stderr, 'utf8', function (err,data) {
                    console.log("----------------------------------stderr------------------------------------------");
                    console.log(data);
                    fs.writeFile(config.rundir+'/terminated.stderr.'+name+'.'+now.getTime(), data);
                    stopwf('FAILED', job.id+' '+name+' permanently failed (code '+info.ret+').. stopping workflow');
                    //oplog({job: job, msg: "job failed permanently", info:info});
                }); 
            }); 
*/
        } else {
            //let's always resubmit .. until retry count reaches
            if(info.ret == 15) {
                oplog({msg : "squid server mulfunctioning at site: "+job.resource_name});
            }

            status(null, job.id+' '+name+' temporarily failed (code '+info.ret+').. resubmitting');
            resubmit(job);

            fs.readFile(job.stdout, 'utf8', function (err,data) {
                console.log("----------------------------------stdout------------------------------------------");
                console.log(data);
                fs.writeFile(config.rundir+'/terminated.stdout.'+name+'.'+now.getTime(), data);
            }); 
            fs.readFile(job.stderr, 'utf8', function (err,data) {
                console.log("----------------------------------stderr------------------------------------------");
                console.log(data);
                fs.writeFile(config.rundir+'/terminated.stderr.'+name+'.'+now.getTime(), data);
            }); 
        }
    }

    function split_input() {
        status("RUNNING", "Splitting input "+config.input+" into blocks with "+workflow.block_size+" queries each");
        var deferred = Q.defer();
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
                    fs.writeFile(config.rundir+'/input.qb_'+block+'.fasta.tmp', data, function(err) {
                        if(err) next(err) 
                        else {
                            block++;
                            next();
                        }
                    });
                }); 
            },
            function(err) {
                if(err) deferred.reject(err);
                else {
                    console.log("done splitting data");
                    deferred.resolve(block);
                }
            }
        );
        return deferred.promise;
    }

    function submitjob(block, dbpart, submitted, success, resubmit, stopwf) {
        var _rundir = null; //_rundir for this particualar job (not config.rundir)
        var starttime;

        var job = workflow.submit({
            executable: __dirname+'/blast.sh',
            receive: ['output'],
            //arguments: [],
            timeout: 3*60*60*1000, //kill job in 3 hours (job should finish in 1.5 hours)
            timeout_reason: "each job should not run more than 3 hours",

            //timeout: 60*1000, //debug.. 1 minutes

            description: 'blast query block:'+block+' on dbpart:'+dbpart,

            debug: config.debug,
            tmpdir: config.tmpdir,

            condor: condor,
            rundir: function(rundir, done_prepare) {
                _rundir = rundir;
                async.series([
                    //send blast binary to run
                    function(next) {
                        which(config.blast, function(err, path) {
                            if(err) {
                                console.log("can't find blast executable:"+config.blast);
                            } else {
                                fs.symlink(path, rundir+'/'+config.blast, next);
                            }
                        });
                    },
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
                        fs.symlink(config.rundir+'/input.qb_'+block+'.fasta.tmp', rundir+'/input.fasta', next);
                    },
                    //write out input param file
                    function(next) {
                        fs.open(rundir+'/params.sh', 'w', function(err, fd) {
                            fs.writeSync(fd, "export inputquery=input.fasta\n");
                            if(config._oasis_dbpath) {
                                fs.writeSync(fd, "export oasis_dbpath="+config._oasis_dbpath+"\n");
                            }
                            if(config._irod_dbpath) {
                                fs.writeSync(fd, "export irod_dbpath="+config._irod_dbpath+"\n");
                            }
                            if(config._user_dbpath) {
                                fs.writeSync(fd, "export user_dbpath="+config._user_dbpath+"\n");
                            }
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

            //store information I need to resubmit later
            job._block = block;
            job._dbpart = dbpart;

            console.log(job.id+" submitted job qb:"+block+" dbpart:"+dbpart+" rundir:"+job.rundir);
            submitted(null); //null for err

            if(workflow.removed) {
                console.log("workflow already removed .. removing job");
                job.remove();
            }
        });
        job.on('submitfail', function(err) {
            console.log("failed to submit job :: "+err);
            submitted(err); //null for err
        });

        /*
        job.on('timeout', function(info) {
            console.log(job.id+" timed out - resubmitting qb:"+block+" dbpart:"+dbpart);

            //TODO - should I to hold & release instead?
            job.remove(); 
            resubmit(job);
        });
        */

        job.on('imagesize', function(info) {
            console.log(job.id+' qb:'+block+' db:'+dbpart+' imagesize update '+JSON.stringify(info));
            //oplog({info: info});
        });

        job.on('hold', function(info) {
            oplog({job: job, msg: "hold event", info: info});

            var now = new Date();
            job.q(function(err, data) {
                if(err) {
                    stopwf('FAILED', job.id+' qb:'+block+' db:'+dbpart+" held but couldn't run condor_q .. aborting workflow :"+err);
                    oplog({job: job, msg: "condor_q failed", err: err});
                } else {
                    //console.dir(data);
                    if(data.JobRunCount < 3) {
                        switch(info.HoldReasonSubCode) {
                        case 1: //timeout
                            console.log(job.id+' qb:'+block+' db:'+dbpart+" timed out. JobRunCount: "+data.JobRunCount+" ... releasing");
                            break;
                        default: 
                            //console.log(typeof info.HoldReasonSubCode);
                            fs.readFile(job.stdout, 'utf8', function (err,data) {
                                console.log("------stdout-------");
                                console.log(data);
                                fs.writeFile(config.rundir+'/held.stdout.'+block+'.'+dbpart+'.'+now.getTime(), data);
                            }); 
                            fs.readFile(job.stderr, 'utf8', function (err,data) {
                                console.log("------stderr-------");
                                console.log(data);
                                fs.writeFile(config.rundir+'/held.stderr.'+block+'.'+dbpart+'.'+now.getTime(), data);
                            }); 

                            console.log("Unknown hold subcode:"+info.HoldReasonSubCode);
                            console.log(job.id+' qb:'+block+' db:'+dbpart+" JobRunCount: "+data.JobRunCount+" ... releasing");
                            console.dir(info);

                            oplog({job: job, data: data, info: info});
                        }

                        //rerun
                        var stat = workflow.get_runtime_stats(job.resource_name);

                        //debug
                        console.log("dumping runtime stat for "+job.resource_name);
                        console.dir(stat);

                        if(stat && stat.hold.length > 10) {
                            oplog({msg: job.resource_name + " had too many holds.. blacklisting this site for this workflow"});
                            condor.Requirements = "(GLIDEIN_ResourceName =!= \""+job.resource_name+"\") && "+condor.Requirements;
                        }
                        job.release();
                    } else {
                        stopwf('FAILED', 'Job:'+job.id+' ran too many times:'+data.JobRunCount+' .. aborting workflow. ');
                        oplog({job: job, msg: "ran too many times.. aborting workflow", data: data});
                    }
                }
            });
        });
        job.on('execute', function(info) {
            //console.log(job.id+' qb:'+block+' db:'+dbpart+' started with rundir:'+_rundir);
        });
        job.on('q', function(info) {
            status(null, job.id+" qb:"+block+" db:"+dbpart+" running on "+job.resource_name + " rundir:"+_rundir);
        });
        job.on('exception', function(info) {
            console.log(job.id+' qb:'+block+' db:'+dbpart+' exception on '+job.resource_name+' :: '+info.Message);
            oplog({job: job, block: block, dbpart: dbpart, message: "exception: " + info.Message});
            /*
            if(config.opissue_log) {
                fs.appendFile(config.opissue_log, job.id+' qb:'+block+' db:'+dbpart+' exception on '+job.resource_name+' :: '+info.Message+"\n");
            }
            */
        });
        job.on('evict', function(info) {
            //I am not sure if I've ever seen this happen
            console.log(job.id+' qb:'+block+' db:'+dbpart+' evicted on '+job.resource_name);
            console.dir(info);//debug
            //TODO - I believe evict events are followed by abort/terminate type event.. so I don't have to do anythig here?
        });

        job.on('abort', function(info) {
            //stopwf('ABORTED', job.id+' qb:'+block+' db:'+dbpart+' job aborted.. stopping workflow');
            console.log(job.id+' qb:'+block+' db:'+dbpart+' aborted while running on '+job.resource_name+' -- releasing..:: '+info.Message);
            console.dir(info); //debug
            job.release(); //TODO - can I release an aborted job?
        });

        job.on('terminate', function(info) {
            var name = 'qb_'+block+'.db_'+dbpart;
            terminated(job, info, name, success, resubmit, stopwf);
        });
    }

    //load fasta blocks to test
    function load_test_fasta() {
        //console.log("loading test fasta");
        var fasta_blocks = [];
        var deferred = Q.defer();
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
            function() {deferred.resolve(fasta_blocks); }
        );
        return deferred.promise;
    }

    function submit_tests(fasta_blocks) {
        var deferred = Q.defer();
        var results = []; //test results

        /*
        async.parallel(test_jobs, function(err, results) {
            //post_workflow(); //not sure if I should output this at the end of testing
            if(err) {
                console.log("Test failed.. waiting all to end");
                deferred.reject(err);
            } else {
            }
        });
        */

        function success(job, info) {
            results.push(info); 
            status('TESTING', job.id+' test job successfully completed in '+info.walltime+'ms :: finished:'+results.length+'/'+fasta_blocks.length);

            //all test completed?
            if(results.length == fasta_blocks.length) {
                analyze_results();
            }
        }

        function analyze_results() {
            console.log("test jobs walltimes(ms)");
            console.dir(results);

            //calculate average time it took to run
            var sum = results.reduce(function(psum,result) {return psum+result.walltime}, 0);
            console.log("sum:"+sum);
            console.log("size:"+results.length);
            var average = sum / results.length; 
            console.log("average job walltime(ms):"+average);

            //compute standard deviation
            var sumd = results.reduce(function(d, result) {
                var diff = average - result.walltime;
                return d+diff*diff;
            }, 0);
            var sdev = Math.sqrt(sumd/fasta_blocks.length);
            console.log("standard deviation:"+sdev);

            //check if all values are within sdev
            //results.forEach(function(result) {
            //    if(Math.abs(result - average) > sdev) {
            //        console.log("test result:"+result+" is outside S:"+sdev+" with average:"+average);
            //        deferred.reject();
            //        return;
            //    }
            //});
            //console.log("test results ok");

            //calculate optimum query block size
            workflow.block_size = parseInt(workflow.target_job_duration / average * workflow.test_job_block_size);
            if(workflow.block_size < 10) {
                //prevent input query split too small.. (0 is definitely too small)
                deferred.reject("computed blocksize:"+workflow.block_size+" is too small");
            } else {
                console.log("running main workflow with computed block size:" + workflow.block_size);
                deferred.resolve();
            }
        }

        function resubmit(job) {
            var fastas = job._fastas;
            var part = job._part;

            if(workflow.test_resubmits > 0) {
                status('TESTING', job.id+' re-submitting test job part:'+part);
                //TODO - check retry count and abort workflow if it's too high
                //if(retrycount > 4) {
                //    reject()
                //} else {
                submittest(fastas, part, null, success, resubmit, stopwf);
                workflow.test_resubmits--;
            } else {
                stopwf('FAILED', ' test job re-submited too many times '+workflow.test_resubmits+'... aborting workflow. ');
                oplog({job: job, msg: "test job re-submitted too many times"});
            }
        }

        function stopwf(st, err) {
            status(st, err);
            post_workflow();
            workflow_registry.remove(workflow);
            deferred.reject(st+" :: " + err);
        }

        //now submit
        var part = 0;
        async.whilst(
            function() { return part<fasta_blocks.length; },
            function(next_part) {
                submittest(fasta_blocks[part], part, next_part, success, resubmit, stopwf);
                part++;
            },
            function() {
                status("TESTING", "submitted all test jobs:"+part);
            }
        );

        /*
        console.log("creating test jobs with "+jobnum);
        var test_jobs = [];
        function pushtestjob(i) {
            fastas = fasta_blocks[i];
            console.log("creating test job "+i +" using "+fastas.length+" fastas");
            test_jobs.push(function(next) {
                submittest(fastas, i, next);
            });
        }
        for(var i in fasta_blocks) {
            pushtestjob(i);
        }
        */

        return deferred.promise;
    }

    function submit_jobs(blocks) {
        var jobnum = config.dbinfo.parts.length*blocks;
        var jobdone = 0;
        var deferred = Q.defer();

        var resubmitted = {}; //list of jobs that are resubmited, and count

        console.log("number of blocks:"+blocks+" number of db parts:"+config.dbinfo.parts.length);
        function success(job, info) {
            jobdone++;
            status('RUNNING', job.id+' successfully completed in '+info.walltime+'ms :: finished:'+jobdone+'/'+jobnum);

            //job completed?
            if(jobdone == jobnum) {
                //console.log("resolving workflow");
                status('COMPLETED', 'all jobs successfully completed. total jobs:'+jobnum);
                post_workflow();
                deferred.resolve();
            }
        }

        function resubmit(job)  {
            var block = job._block;
            var dbpart = job._dbpart;

            //count number of time this job has been resubmitted
            var jid = block+"."+dbpart;
            if(!resubmitted[jid]) {
                resubmitted[jid] = 0;
            }
            resubmitted[jid]++;
        
            if(resubmitted[jid] > 5) {
                stopwf('FALED', 'job:'+jid+' re-submitted too many times');
            } else {
                status('RUNNING', job.id+' re-submitting qb_'+block+' db_'+dbpart);
                //TODO - check retry count and abort workflow if it's too high
                //if(retrycount > 4) {
                //    reject()
                //} else {
                submitjob(block, dbpart, function() {}, success, resubmit, stopwf);
            }
        }

        function stopwf(st, err) {
            status(st, err);
            post_workflow();
            workflow_registry.remove(workflow);
            deferred.reject(st+" :: " + err);
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
                        submitjob(block-1, dbpart-1, next_block, success, resubmit, stopwf);
                    }, next_dbpart
                );
            },
            function() {
                //console.log("finished submitting everything");
                status("RUNNING", "submitted all jobs:"+jobnum);
            }
        );
        return deferred.promise;
    }

    function post_workflow() {
        var log = workflow.print_runtime_stats();
        status(null, "Workflow statistics:\n"+log);
    }
};

