var async = require('async');
var path = require('path');
var fs = require('fs');
var argv = require('optimist').argv;
var http = require('http');

//TODO - I think I should try using stream2/split/through2, etc..
function readfastas(file, num, cb) {
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
            if(err) throw err;
            cb(fastas);
        }
    );
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

function load_config(cb) {
    var config_path;
    if (!argv.config) {
        console.log("please specify --config for config.json path");
        process.exit(1);
    }
    config_path = path.resolve(argv.config)
    if(!fs.existsSync(config_path)) {
        console.log("failed to find config:"+config_path);
        process.exit(2);
    }
    
    var config = require(config_path);

    /*
    //convert input query path to absolute path
    if(_config.input[0] != "/") {
        _config.input = _config.rundir+"/"+_config.input;
        console.log("using input path:"+_config.input);
    }
    */

    config.rundir = config.rundir || path.dirname(config_path);
    config.user = config.user || process.getuid();
    config.oasis_min_revision = config.oasis_min_revision || 3687; //TODO - need to load this from somewhere else
    config.tmpdir = config.tmpdir || '/tmp'; //should never use /tmp in xd-login
    config.condor = config.condor || {};
    config.condor.Requirements = config.condor.Requirements || "(TARGET.Arch == \"X86_64\")"; //need something to start with.

    ///////////////////////////////////////////////////////////////////////////////////////////////
    //  
    //load db info
    //
    var dbtokens = config.db.split(":");
    if(dbtokens[0] == "oasis") {
        config.condor.Requirements = "(TARGET.HAS_CVMFS_oasis_opensciencegrid_org =?= True) && "+config.condor.Requirements;
        config.condor.Requirements = "(TARGET.CVMFS_oasis_opensciencegrid_org_REVISION >= "+config.oasis_min_revision+") && "+config.condor.Requirements;
        //console.log("processing oasis dbinfo");
        
        //TODO - validate dbtokens[1] (don't allow path like "../../../../etc/passwd"
        var oasis_dbpath = "/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/"+dbtokens[1];
        config._oasis_dbpath = oasis_dbpath;

        config._db_name = dbtokens[1].split(".")[0]; //nt.1-22-2014  >> nt
        var pdir = oasis_dbpath+"/"+config._db_name;
        //status('TESTING', "loading dbinfo from oasisdb:"+pdir);
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
        //status('TESTING', "oasis dbinfo loaded");
        cb(null, config);
    } else if(dbtokens[0] == "irods") {
        //we use irods binary stored in oasis.
        condor.Requirements = "(HAS_CVMFS_oasis_opensciencegrid_org =?= True) && "+condor.Requirements;
        //we need to use osg-blast/osg-xsede.grid.iu.edu service cert
        //condor.x509userproxy = "/local-scratch/iugalaxy/blastcert/osgblast.proxy"; // blastcert/proxy_init.sh
        condor.x509userproxy = path.resolve(config.x509userproxy);

        console.log("processing irods dbinfo");
        config._irod_dbpath = "irodse://goc@irods.fnal.gov:1247?/osg/home/goc/"+dbtokens[1];

        config._db_name = dbtokens[1].split(".")[0]; //nt.1-22-2014  >> nt
        //var pdir = "/local-scratch/iugalaxy/blastdb/"+dbtokens[1]+"/"+config._db_name;
        var pdir = "/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb/"+dbtokens[1]+"/"+config._db_name;
        //status('TESTING', "loading dbinfo from "+pdir);
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
        //status('TESTING', "irods dbinfo loaded");
        //console.dir(config.dbinfo);
        cb(null, config);
    } else {
        //status('TESTING', "processing user dbinfo");
        //assume http or ftp partial url (http://osg-xsede.grid.iu.edu/scratch/hayashis/userdb/11c2c67532d678042b684c52f888e7bd:sts)
        config._db_name = dbtokens.pop(); //grab last 
        config._user_dbpath = dbtokens.join(":");

        //console.log("outputting user db config again");
        //console.dir(config);

        //try downloading pal
        var apath = config._user_dbpath+"/"+config._db_name;
        //console.log("trying to download "+apath+".pal");
        http_get(apath+".pal", function(err, data) {
            if(data) {
                config.dbinfo = load_db_info(data);
                cb(null, config);
            } else {
                //console.log("trying to download "+apath+".nal");
                http_get(apath+".nal", function(err, data) {
                    if(data) {
                        config.dbinfo = load_db_info(data);
                        cb(null, config);
                    } else {
                        //console.log("it must be a single db");
                        //single part db
                        config.dbinfo = {
                            title: config._db_name, //TODO - pull real name from db somehow?
                            parts: [config._db_name]
                        };
                        cb(null, config);
                    }
                });
            }
        });
    }
}

function load_db_info(data) {
    /* parses content that looks like..
    #
    # Alias file created 12/13/2013 08:36:19
    #
    TITLE Nucleotide collection (nt)
    DBLIST                  "nr.00" "nr.01" "nr.02" "nr.03" "nr.04" "nr.05" "nr.06" "nr.07" "nr.08" "nr.09" "nr.10" "nr.11" "nr.12" "nr.13" "nr.14" "nr.15" "nr.16" "nr.17" "nr.18" "nr.19" "nr.20" "nr.21" "nr.22" "nr.23" "nr.24" "nr.25" "nr.26" "nr.27" "nr.28" "nr.29" "nr.30" "nr.31"
    NSEQ 20909183
    LENGTH 52564451792
    */
    var dbinfo_lines = data.split("\n");
    //console.dir(dbinfo_lines);
    
    //strip unnecessary double quote marks recently added by makeblastdb(?)
    var parts = dbinfo_lines[4].substring(7).trim().split(" ");
    var clean_parts = [];
    parts.forEach(function(part) {
        if(part[0] == "\"") part = part.substring(1, part.length-1);
        clean_parts.push(part);
    });

    return {
        title: dbinfo_lines[3].substring(6),
        parts: clean_parts,
        num_seq: parseInt(dbinfo_lines[5].substring(5)),
        length: parseInt(dbinfo_lines[6].substring(7))
    };
}

function construct_env(config) {
    var env = {};
    if (!argv.outdir) {
        console.log("please specify --outdir for output directory");
        process.exit(1);
    }
    if(config._oasis_dbpath) {
        env.oasis_dbpath=config._oasis_dbpath;
    }
    if(config._irod_dbpath) {
        env.irod_dbpath=config._irod_dbpath;
    }
    if(config._user_dbpath) {
        env.user_dbpath=config._user_dbpath;
    }
    env.inputquery = 'query.$(process).fa';
    env.outdir = argv.outdir;
    env.outputname = '$(dbname).q.$(process)';
    env.process = '$(Process)'; //only test uses this, but why not set this here?
    env.blast = config.blast;
    env.dbname = '$(dbname)';
    env.blast_opts="'"+config.blast_opts+"'";
    if(config.dbinfo.length) {
        env.dbsize = config.dbinfo.length;
    }


    return env;
}

exports.readfastas = readfastas;
exports.load_config = load_config;
exports.construct_env = construct_env;


