var osg = require('osg');
var fs = require('fs');
var path = require('path');
var async = require('async');

var condor = {
    //needed to run jobs on osg-xsede
    "+ProjectName": "CSIU",
    "+PortalUser": "hayashis",
    //"Requirements": "(GLIDEIN_ResourceName == \"Tusker\")"
    "Requirements": "(GLIDEIN_ResourceName == \"SMU_HPC\")"
}

var events = osg.submit({
    executable: 'oasis_throughput.sh',
    condor: condor, //some common condor options we need to pass
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
    console.log("job terminated");
    console.dir(info);
    fs.readFile(job.options.output, 'utf8', function (err,data) {
        console.log(data);
    }); 
    fs.readFile(job.options.error, 'utf8', function (err,data) {
        console.log(data);
    }); 
});

