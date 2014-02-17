var async = require('async');

var num = 10000;
function isgoing() {
    return (num-- > 0);
}

async.whilst(
isgoing,
function(next) {next(); },
function() {console.log('done');}
);
