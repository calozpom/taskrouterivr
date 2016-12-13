var req = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var twilio = require('twilio');
var express = require('express');
var app = express();

app.set('port', (process.env.PORT || 5000));


var accountSid = process.env.accountSid;
var authToken = process.env.authToken;
var workspaceSid = process.env.workspaceSid;
var workerSid = process.env.workerSid;


app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

app.get('/alive', function(request, response) {
 
  response.send('I AM ALIVE');
});


