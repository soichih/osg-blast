var fs = require('fs');

var osg = require('osg');
var temp = require('temp');
var Fasta = require('./fasta').Fasta;

//var config = require('./config');
var config = {
    project: 'CSIU',
    user: 'hayashis', //username to report to osg-xsede (usually the real submitter of the job)

    rundir: '/local-scratch/hayashis/rundir/blast2',
    input_query: '/local-scratch/hayashis/rundir/blast2/nr.20000.fasta',
};

var condor = {
    //needed to run jobs on osg-xsede
    "+ProjectName": config.project,
    "+PortalUser": config.user,

    //cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)
    //SPRACE doesn't update oasis (goc ticket 19587)
    "Requirements": "(GLIDEIN_ResourceName =!= \"cinvestav\") && (GLIDEIN_ResourceName =!= \"SPRACE\") && (HAS_CVMFS_oasis_opensciencegrid_org =?= True) && (Memory >= 2000) && (Disk >= 500*1024*1024)"
}

//write out the pid file
fs.writeFile(config.rundir+"/pid.txt", process.pid.toString());

//write out the main status file
function update_status(status, message) {
    fs.writeFile(config.rundir+"/status.txt", status+"\n"+message);
}

function test() {
    update_status('R', 'Testing');
    osg.submit({
        executable: 'blast.sh',
        arguments: 'test.fasta /cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/nr.1-22-2014 nr.00',
        timeout: 200, //kill job if it doesn't finish in time (sec)
        condor: condor //some common condor options we need to pass
    }, {
        prepare: function(rundir, next) {
            console.log("using rundir:"+rundir);

            //grab first 100 queries, and measure how long it takes to execute
            var f = new Fasta(config.input_query);
            f.read(5, function(fastas) {
                fs.open(rundir+'/test.fasta', 'w', function(err, fd) {
                    fastas.forEach(function(fasta) {
                        fs.write(fd, fasta);
                        fs.write(fd, '\n');
                    });
                    fs.close(fd);
                    next();
                });
            });
        },

        submit: function(job, info) {
            console.dir(info);

            osg.q(job).then(function(data) {
                console.log("running on "+data.MATCH_EXP_JOB_Site);
            });
        },
        progress: function(job, info) {
            console.dir(info);
        },
        exception: function(job, info) {
            console.dir(info);

            job.log.unwatch();
            throw info.Message;
        },
        held: function(job, info) {
            console.dir(job);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 

            console.log("unwatching");
            job.log.unwatch();

            console.log("removing job");
            osg.remove(job);
        },
        evicted: function(job, info) {
            console.log("job evicted");
            console.dir(info);
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            fs.readFile(job.options.error, 'utf8', function (err,data) {
                console.log(data);
            }); 

            console.log("unwatching");
            job.log.unwatch();
        },
        terminated: function(job, info) {
            console.log("job terminated with return code:"+info.ReturnValue);
            console.dir(info);
            if(info.ret == 0) {
                update_status('R', 'Test Success');
                /*
                fs.readFile(job.options.output, 'utf8', function (err,data) {
                    console.log(data);
                }); 
                */
                fs.readFile(info.rundir+"/output.xml", 'utf8', function(err, data) {
                    if(err) {
                        console.log("failed to open output.xml");
                    } else {
                        console.log(data.substring(0, 3000));
                    }
                });
            } else {
                update_status('T', 'Test Fail');
                fs.readFile(job.options.output, 'utf8', function (err,data) {
                    console.log(data);
                }); 
                fs.readFile(job.options.error, 'utf8', function (err,data) {
                    console.log(data);
                }); 
            }

            //dumping output.xml from the rundir
            //console.dir(job);
            //console.dir(job.options);

            console.log("unwatching");
            job.log.unwatch();
        },
    });
}


test();
