var req = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var twilio = require('twilio');
var express = require('express');
var app = express();

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
})); // support encoded bodies


var accountSid = process.env.accountSid;
var authToken = process.env.authToken;
var workspaceSid = process.env.workspaceSid;
var workflowSid = process.env.workflowSid;

var client = new twilio.TaskRouterClient(accountSid, authToken, workspaceSid);

//var workerSid = process.env.workerSid;

/* the overview of this application is:
This is a state machine which uses TaskRouter as the underlying engine for an IVR. Each Queue within TaskRouter represents a node within an IVR tree
 - When a call comes in to a twilio Number, Twilio Webhooks to this application requesting TwiML instructions to the call
 - While that webhook is pending, we create a task for the call and set it's attribute current_step to the first node of the IVR
 - We lookup what TwiML response should be indexed by the node name, and what the next node should be
 - We update the task with the new next_step attribute

 - The Task will enter a TaskQueue, causing Twilio to webhook again to this application to notify that the task has moved to a new IVR node (a task queue)
 - 
*/

app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});

app.get('/nodechange', function(request, response) {
    // This function is triggered on the event when a task changes TaskQueue. TaskQueues represent individual nodes within an IVR.
    if (request.body.TaskSid && request.body.EventType == "task-queue.entered") {
        console.log("task moved into new queue " + request.body.TaskQueueSid);
    }
});

app.get('/initiateivr', function(request, response) {
    /* This function is triggered when a call fir
     */

});

app.get('/continueivr', function(request, response) {
    /*  This function is triggered when an IVR element such as gather provides another webhook.
        It:
        - fetches the TaskSID for this current call
        - Updates the attributes for this task with the content from the webhook request (e.g. DTMF digits)
        - Fetches the new TaskQueue which the task has been routed to based on those digits
        - Fetches the TwiML for that TaskQueue
        - Responds to the webhook with that TwiML
    */
    if (request.body.TaskSid && request.body.EventType == "task-queue.entered") {
        console.log("task moved into new queue " + request.body.TaskQueueSid);
    }
});

function createTask(attributesJson, fn) {
	var attributesString = JSON.stringify(attributesJson);

	var options = {
        method: 'POST',
        url: 'https://taskrouter.twilio.com/v1/Workspaces/' + workspaceSid + '/Tasks',
        auth: {
            username: accountSid,
            password: authToken
        },
        form: {
            WorkflowSid: workflowSid,
            Attributes: attributesString
        }
    };
    console.log("want to create a new task with these attributes");
    console.log(attributesString);
    req(options, function(error, response, body) {
        if (error) throw new Error(error);
        //console.log(body);
        var newTaskResponse = JSON.parse(body);
        console.log("created a new tasks with Sid " + newTaskResponse.sid);
        fn(newTaskResponse.sid);
    });
    
}

function checkForExistingTask(CallSid, fn) {
	console.log("checking for any existing task for this call SID: " + CallSid);
	var taskSid=false;
	var queryJson = {};
	queryJson['EvaluateTaskAttributes'] = "(CallSid=\"" + CallSid + "\")";
	client.workspace.tasks.get(queryJson, function(err, data) {
        if (!err) {
            // looping through them, but call SIDs are unique and should only ever be one task maximum 	
            data.tasks.forEach(function(task) {
                console.log("found an existing task for this call. Trying to list attributes");
                console.log(task.attributes);
                console.log("will use this existing task sid for this conversation " + task.sid);
                taskSid=task.sid;
            });
        }
    });
    fn(taskSid);
}
app.post('/initiateivr', function(request, response) {

    var foundTask = 0;
    var attributesJson = {};
    attributesJson['CallSid'] = request.body['CallSid'];
    attributesJson['From'] = request.body['From'];
    attributesJson['To'] = request.body['To'];
    
	
    checkForExistingTask(request.body['CallSid'], function(returnedTaskSid){
    	if (!returnedTaskSid) {
    		console.log("did not find an existing task for call sid " + request.body['CallSid'])
			createTask(attributesJson, function(returnedTaskSid){
				console.log("created a new task for this call with SID " + returnedTaskSid);
				response.send(returnedTaskSid);
			});
    	}
    	else {
    		console.log("existing call, call SID " + request.body['CallSid'] +" correlates to task " + returnedTaskSid);
    		response.send(returnedTaskSid);
    	}
    });
    
    /*console.log("received this from dataToReturn " + dataToReturn);
    return dataToReturn;*/
            //note the following call is async
            //Here I am looking up for a current task from this user. I could alternatively cookie the request, but that is time limited.
            /*
    var dataToReturn = client.workspace.tasks.get(queryJson, function(err, data) {
        if (!err) {
            // looping through them, but call SIDs are unique and should only ever be one task maximum 	
            data.tasks.forEach(function(task) {
                foundTask = 1;
                console.log("found an existing task for this call. Trying to list attributes");
                console.log(task.attributes);
                console.log("will use this existing task sid for this conversation " + task.sid);
                return task.sid;
                //updateConversationPost(taskConversationSid, request, friendlyName_first, friendlyName_last);

            });

            if (!foundTask) {
                console.log("did not find an existing active task for this IVR call - must be new call");

                var attributesJson = {};
                attributesJson['CallSid'] = request.body['CallSid'];
                attributesJson['From'] = request.body['From'];
                attributesJson['To'] = request.body['To'];
                console.log("want to create a new task with these attributes");
                console.log(attributesJson);
                var attributesString = JSON.stringify(attributesJson);

                var options = {
                    method: 'POST',
                    url: 'https://taskrouter.twilio.com/v1/Workspaces/' + workspaceSid + '/Tasks',
                    auth: {
                        username: accountSid,
                        password: authToken
                    },
                    form: {
                        WorkflowSid: workflowSid,
                        Attributes: attributesString
                    }
                };

                var dataToReturn = req(options, function(error, response, body) {
                    if (error) throw new Error(error);
                    //console.log(body);
                    var newTaskResponse = JSON.parse(body);
                    console.log("created a new tasks with Sid " + newTaskResponse.sid);
                    return newTaskResponse.sid;

                });
                console.log("received this from dataToReturn " + dataToReturn);
                return dataToReturn;
            }
        }
    });
    */
    /*console.log("received this from dataToReturn " + dataToReturn);
    response.send(dataToReturn);*/

});

app.get('/alive', function(request, response) {

    response.send('I AM ALIVE');
});
