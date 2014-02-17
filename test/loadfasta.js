var async = require('async');
var Fasta = require('../fasta').Fasta;
var f = new Fasta("nt.20000.fasta");

var cont = true;
async.whilst(
    function() { return cont; },
    function(next) {
        f.read(50, function(fastas) {
            if(fastas.length == 0) cont = false;
            else { 
                //console.dir(fastas);
                console.log(fastas.length);
                fastas.forEach(function(fasta) {
                    var pos = fasta.indexOf(">", 1);
                    if(pos != -1) {
                        console.log(fasta);
                    }
                });
            }
            next();
        });
    },
    function() {}
);
