const express = require("express");

const app = express();

app.set('port', (process.env.PORT || 5000));



//静的ファイルを提供するところ index.ejsのsrcはpublic内を参照する
app.use(express.static(__dirname + '/public'));

// CORSを許可する
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});



app.use('/controller',require('./src/app/controller.js')());
app.use('/simulator',require('./src/app/simulator.js')());
app.use('/tester',require('./src/app/tester_get_executions.js')());



app.use(function(err, req, res, next) {
    console.log(err.message);
});

app.listen(app.get('port'), function() {
    console.log("Node app is running at localhost:" + app.get('port'))
});