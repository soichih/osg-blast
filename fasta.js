var fs = require('fs');
var async = require('async');

/*
Some functions to parse a large fasta (should handle up to 10G or more)
*/

var Fasta = function(path, opts) {
    this.fd = fs.openSync(path, 'r');
    this.buffer = new Buffer(256); //TODO - adjust this for performance
    this.loading_fasta = ""; //currently loaded fasta (by readOne)
}

//load up to specified number of fasta entries
Fasta.prototype.read = function(num, callback) {
    var fastas = [];
    var hasmore = true;
    var $this = this;
    async.whilst(
        function() { return num-- && hasmore ; },
        function(next) {
            $this.readOne(function(fasta) {
                if(fasta == "") {
                    hasmore = false;
                } else {
                    fastas.push(fasta);
                }
                next();
            });
        },
        function() {
            callback(fastas);
        }
    );
}

//return empty string if there are no more fasta
Fasta.prototype.readOne = function(callback) {
    //console.log("readOne starting with "+this.loading_fasta);
    while(true) {
        var read = fs.readSync(this.fd, this.buffer, 0, this.buffer.length, null);
        if(read == 0) {
            //reached the end.. output the last fasta
            var ret = this.loading_fasta;
            this.loading_fasta = "";
            callback(ret);
            break;
        }
        //console.log("read "+read+"\n");

        var chunk = this.buffer.toString('utf8', 0, read);
        //console.log(chunk+"\n");
        //got some data.. look for delimiter
        var dpos = chunk.indexOf("\n>");
        //console.log(dpos);
        if(dpos == -1) {
            //add whole thing
            this.loading_fasta += chunk;
        } else {
            //found delimiter
            this.loading_fasta += chunk.substring(0, dpos);
            var ret = this.loading_fasta;
            
            //put remaining back to buffer
            this.loading_fasta = chunk.substring(dpos+1); //skip newline

            callback(ret);
            break;
        }
    }
}

exports.Fasta = Fasta;

