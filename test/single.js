var osg = require('osg');
var fs = require('fs');
var path = require('path');
var async = require('async');

var condor = {
    //needed to run jobs on osg-xsede
    "+ProjectName": "CSIU",
    "+PortalUser": "hayashis",
    //cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)
    "Requirements": "(GLIDEIN_ResourceName == \"SPRACE\") && (Memory >= 2000) && (Disk >= 500*1024*1024)"
}

var events = osg.submit({
    executable: '../blast.sh',
    timeout: 60*2*1000, //kill job if it doesn't finish in time (sec)
    condor: condor, //some common condor options we need to pass
    rundir: function(rundir_path, done_prepare) {
        async.series([
            //symlink input query
            function(next) {
                fs.symlink(path.resolve('nt.2000.fasta'), rundir_path+'/test.fasta', next);
            },
            //write out input param file
            function(next) {
                fs.open(rundir_path+'/params.sh', 'w', function(err, fd) {
                    fs.writeSync(fd, "export inputquery=test.fasta\n");
                    fs.writeSync(fd, "export dbpath=/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/human_genomic.1-22-2014\n");
                    fs.writeSync(fd, "export dbname=human_genomic.00\n");
                    fs.writeSync(fd, "export blast=blastn\n");
                    fs.writeSync(fd, "export blast_opts=\"-evalue 0.001 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0\"\n");
                    fs.writeSync(fd, "export size_opts=\"-dbsize 52564451792\"\n");
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
    console.log("submitted");
});
events.on('execute', function(job, info) {
    console.log("job running.. q-ing");
    osg.q(job).then(function(data) {
        console.log('running running on '+data.MATCH_EXP_JOBGLIDEIN_ResourceName);
        resourcename = data.MATCH_EXP_JOBGLIDEIN_ResourceName;
    });
});
events.on('progress', function(job, info) {
    console.dir(info);
});
events.on('exception', function(job, info) {
    throw info.Message;
});
events.on('hold',function(job, info) {
    console.log("job held");
    console.dir(job);
    console.dir(info);
    fs.readFile(job.options.output, 'utf8', function (err,data) {
        console.log(data);
    }); 
    fs.readFile(job.options.error, 'utf8', function (err,data) {
        console.log(data);
    }); 

    console.log("removing job");
    osg.remove(job);
});
events.on('evict', function(job, info) {
    console.log("job evicted");
    console.dir(info);
    fs.readFile(job.options.output, 'utf8', function (err,data) {
        console.log(data);
    }); 
    fs.readFile(job.options.error, 'utf8', function (err,data) {
        console.log(data);
    }); 
});
events.on('terminate', function(job, info) {
    console.log("job terminated with return code:"+info.ret);
    if(info.ret == 0) {
        fs.readFile(job.options.output, 'utf8', function (err,data) {
            console.log(data);
        }); 
        fs.readFile(info.rundir+"/output", 'utf8', function(err, data) {
            if(err) {
                console.log("failed to open output");
                console.log(err);
            } else {
                console.log(data.substring(0, 3000));
            }
        });
    } else {
        fs.readFile(job.options.output, 'utf8', function (err,data) {
            console.log(data);
        }); 
        fs.readFile(job.options.error, 'utf8', function (err,data) {
            console.log(data);
        }); 
    }
});
