var async = require('async');
var Promise = require('promise');

var cont = true;

var i = 0;
function dosomething() {
    i++;
    console.log(i);
    if(i < 10) return true;
    return false;
}

function p() {
    return new Promise(function(resolve, reject) {
        async.whilst(
            function() { return cont ;},
            function(next) { cont = dosomething(); next(); },
            function() {consolle.log('done');}
        );
    });
}

p().then(function() {
    console.log("done");
    process.exit(0);
}, function(e) {
    console.log("rejected");
    console.log(e);
    process.exit(1);
});
