var osg = require('osg');
var fs = require('fs');

var condor = {
    //needed to run jobs on osg-xsede
    "+ProjectName": "CSIU",
    "+PortalUser": "hayashis",
    //cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)
    "Requirements": "(GLIDEIN_ResourceName =!= \"cinvestav\") && (Memory >= 2000) && (Disk >= 500*1024*1024)"
}

osg.submit({
    send: ['../blast.sh', '/home/hayashis/app/ncbi-blast-2.2.28+/bin/blastx', 'nr.100.fasta'],  
    receive: ['output.xml'],  
    run: './blast.sh',
    timeout: 200, //kill job if it doesn't finish in time (sec)
    condor: condor //some common condor options we need to pass
}, {
    submit: function(job, event) {
        console.log("submitted");
        osg.q(job).then(function(data) {
            console.log("running on "+data.MATCH_EXP_JOB_Site);
        });
    },
    /*
    execute: function(job, event) {
        console.log("job executing");
        console.dir(event);
    },
    */
    progress: function(job, event) {
        console.dir(event);
    },
    exception: function(job, event) {
        job.log.unwatch();

        throw event.Message;
    },
    held: function(job, event) {
        console.log("job held");
        console.dir(job);
        console.dir(event);
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
    evicted: function(job, event) {
        console.log("job evicted");
        console.dir(event);
        fs.readFile(job.options.output, 'utf8', function (err,data) {
            console.log(data);
        }); 
        fs.readFile(job.options.error, 'utf8', function (err,data) {
            console.log(data);
        }); 

        console.log("unwatching");
        job.log.unwatch();
    },
    terminated: function(job, event) {
        console.log("job terminated with return code:"+event.ReturnValue);
        console.dir(event);
        if(event.ReturnValue == 0) {
            /*
            fs.readFile(job.options.output, 'utf8', function (err,data) {
                console.log(data);
            }); 
            */
            fs.readFile(job.rundir+"/output.xml", 'utf8', function(err, data) {
                if(err) {
                    console.log("failed to open output.xml");
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

        //dumping output.xml from the rundir
        //console.dir(job);
        //console.dir(job.options);

        console.log("unwatching");
        job.log.unwatch();
    },
});
