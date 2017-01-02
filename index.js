var req = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var twilio = require('twilio');
var express = require('express');
var app = express();
const querystring = require('querystring');

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

/* the overview of this application is:
This is a state machine which uses TaskRouter as the underlying engine for an IVR. Each Queue within TaskRouter represents a node within an IVR tree
 - When a call comes in to a twilio Number, Twilio Webhooks to this application requesting TwiML instructions to the call
 - While that webhook is pending, we lookup whether a task exists for this call SID
 - If no task exists (it's a new call) then we create a task for the call. It will get routed to the default queue in the TaskRouter workflow
 - If it's an existing task we update it's attributes with the previous node step, and any DTMF entered at that step
 - Whether a new task or an updated task, we retrieve what task queue (node) the task is currently in
 - we fetch the TwiML for that given node, and reply to the webhook with that
*/





app.post('/initiateivr', function(request, response) {
	    /*  This function is triggered when any step in programmable voice triggers a webhook as part of an IVR flow.
        It:
        - fetches the TaskSID for this current call if one exists, or creates one otherwise
        - Updates the attributes for this task with the content from the webhook request (e.g. DTMF digits)
        - Fetches the new TaskQueue which the task has been routed to based on those digits
        - Fetches the TwiML for that TaskQueue
        - Responds to the webhook with that TwiML

        This method relies on a lot of asynchronous function, and uses callbacks for that. Alternatively this could
        be built with promises.
        */

    var attributesJson = {};
	
    checkForExistingTask(request.body['CallSid'], function(returnedTask){
    	//console.log(returnedTask);
    	if (!returnedTask) {
		    attributesJson['CallSid'] = request.body['CallSid'];
		    attributesJson['From'] = request.body['From'];
		    attributesJson['To'] = request.body['To'];
    		console.log("did not find an existing task for call sid " + request.body['CallSid'])
			createTask(attributesJson, function(returnedTask){
				console.log("created a new task for this call with SID " + returnedTask.sid);
				//console.log(returnedTask);
				//response.send(getTwimlForTaskQueue(returnedTask));
				response.send(getTwimlfromTwimlBin(returnedTask));
			});
    	}
    	else {
    		console.log("existing call, call SID " + request.body['CallSid'] +" correlates to task " + returnedTask.sid);
    		console.log("Dialed digits " + request.body['Digits']);
    		attributesJson['exited_node'] = returnedTask.task_queue_friendly_name.split(':')[0];
    		attributesJson[returnedTask.task_queue_friendly_name.split(':')[0] + '_entered_digits'] = request.body['Digits'];
    		updateTask(attributesJson, returnedTask, function(updatedTask){
    			console.log("getting twiml for a task in queue " + updatedTask.task_queue_friendly_name.split(':')[0]);
	    		//response.send(getTwimlForTaskQueue(updatedTask));
				response.send(getTwimlfromTwimlBin(returnedTask));


	    	});
    	}
    });
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
        fn(newTaskResponse);
    });
    
}

function updateTask(attributesJson, task, fn) {
	/*
	This function will update a task with new attributes
	Note that it will append (or overwrite where keys are the same value) but will not delete existing attributes
	*/
	var mergedAttributes = {};
	var currentAttributes = JSON.parse(task.attributes);
	console.log("Updating task which has current attributes of " + task.attributes);
	for(key in currentAttributes)
	    mergedAttributes[key] = currentAttributes[key];
	for(key in attributesJson)
   		mergedAttributes[key] = attributesJson[key];
	var attributesString = JSON.stringify(mergedAttributes);

	var options = {
        method: 'POST',
        url: 'https://taskrouter.twilio.com/v1/Workspaces/' + workspaceSid + '/Tasks/'+ task.sid,
        auth: {
            username: accountSid,
            password: authToken
        },
        form: {
            Attributes: attributesString
        }
    };
    console.log("Updating the existing task with these attributes");
    console.log(attributesString);
    req(options, function(error, response, body) {
        if (error) throw new Error(error);
        //console.log(body);
        var newTaskResponse = JSON.parse(body);
        console.log("updated the task with Sid " + newTaskResponse.sid + "with attributes");
        console.log("Task is now in the queue " + newTaskResponse.task_queue_friendly_name.split(':')[0]);
        /* In an ideal world this would be all you'd have to do
        But TaskRouter will sometimes return the task before the workflow has been re-run and so you'll still get the current queue
        back not the new queue
        the foreceTaskRefresh function and call here is to ensure that the workflow has been re-evaluated and the task is in the new queue*/
        forceTaskRefresh(newTaskResponse.sid, function(updatedTask){
        	console.log("Forced a workflow refresh");
        	console.log("Attempting to look for the task again with call sid " + mergedAttributes['CallSid'])
        	checkForExistingTask(mergedAttributes['CallSid'], function(returnedTask){
        		console.log("forcibly updated task. New queue is now " + returnedTask.task_queue_friendly_name.split(':')[0]);
        		fn(returnedTask);
        	});
        });
        
        //fn(newTaskResponse);
    });
    
}

function forceTaskRefresh(taskSid, fn) {
	var tempOptions = {
	      method: 'POST',
	      url: 'https://taskrouter.twilio.com/v1/Workspaces/' + workspaceSid + '/Workflows/' + workflowSid,
	      auth: {
	        username: accountSid,
	        password: authToken
	      },
	      form: {
	        ReEvaluateTasks: true
	      }
	    };
	    req(tempOptions, function(error, response, body) {
	      if (error) throw new Error(error);
	      fn(true);
	  });

}

function checkForExistingTask(CallSid, fn) {
	console.log("checking for any existing task for this call SID: " + CallSid);
	var taskToReturn=false;
	var queryJson = {};
	queryJson['EvaluateTaskAttributes'] = "(CallSid=\"" + CallSid + "\")";
	client.workspace.tasks.get(queryJson, function(err, data) {
        if (!err) {
            // looping through them, but call SIDs are unique and should only ever be one task maximum 	
            // using a for loop instead of for each since we want to exit completely if we find one
            for (var i=0; i< data.tasks.length; i++) {
            	var task=data.tasks[i]
                console.log("found an existing task for this call. Trying to list attributes");
                console.log(task.attributes);
                console.log("will use this existing task sid for this conversation " + task.sid);
                taskToReturn=task;
                fn(taskToReturn);
                return;
            }
            fn(taskToReturn);
        }
        else {
        	fn(taskToReturn);
        }
    });
    
}

function getTwimlfromTwimlBin(task) {
	var taskAttributes=JSON.parse(task.attributes);
	var resp=new twilio.TwimlResponse();

	
	for (key in taskAttributes) {
		/* First we will rename the attribute keys, because we want to use our own
		"From" rather than the one natively available to the twimlBin, due to needing to edit it to
		Make Alice speak numbers right
		*/
		newKey = "task_"+key;
		taskAttributes[newKey]=taskAttributes[key];
		delete taskAttributes[key];
		/* Next lets match anything that a number or an E164 number and put spaces between them
		to make alice speak it right */
		var editedAttributeValue = taskAttributes[newKey].replace(/^\+*\d+$/gi, function(a,b) {
			var result =a.split('').join('  ');
 			return result;
        
		});
		taskAttributes[newKey]=editedAttributeValue;
	}
	var redirectUrl="";
	redirectUrl+="https://handler.twilio.com/twiml/";
	// Extract the TwiML Bin URL from the taskqueue name:
	redirectUrl+=task.task_queue_friendly_name.split(':')[1];

	redirectUrl+=querystring.stringify(taskAttributes);
	resp.redirect(redirectUrl);

	return resp.toString();
}































/* 
Functions below here are placeholders for where you could add additional logic
*/

app.get('/nodechange', function(request, response) {
    /* This function is triggered on the event when a task changes TaskQueue. TaskQueues represent individual nodes within an IVR.
    */
    if (request.body.TaskSid && request.body.EventType == "task-queue.entered") {
        console.log("task moved into new queue " + request.body.TaskQueueSid);
    }
});

/* 
functions beneath here are not core to the function and can be ignored or were built during the process as test functions.
*/

app.get('/alive', function(request, response) {

    response.send('I AM ALIVE');
});

app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});

function getTwimlForTaskQueue(task) {
	var twimlResponse="";
	 switch (task.task_queue_friendly_name) {
      case "first_node":
        twimlResponse="<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Gather timeout=\"10\" finishOnKey=\"*\"><Say>This call was routed to the first node. Please enter your zip code followed by star</Say></Gather><Redirect></Redirect></Response>"
        break;

     case "second_node":
        twimlResponse="<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>This call from %From% was routed to the second node. You entered %first_node_entered_digits%</Say><Redirect></Redirect></Response>"
        break;
     case "enqueue":
        twimlResponse="<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>This call from %From% was routed to the second node. You entered %first_node_entered_digits%</Say></Response>"
        break;
    }
    return replaceTokensWithAttributes(twimlResponse, task);
    //return twimlResponse;
}

function replaceTokensWithAttributes(twimlResponse, task) {
	/*
	This function will take a given twiml response and look for any tokens of the form %token_name%
	If it finds them it will then look at the provided task and if there are any attributes of name token_name
	It will replace tokens with the value of the attribute for the given task
	If that value is a number it will also split it from e.g. 94598 to 9 4 5 9 8 so that Alice pronounces it correctly
	*/
	console.log("Attempting to replace tokens");
	var parsedResponse = twimlResponse.replace(/%(.*?)%/gi, function(a,b) {
 		if (JSON.parse(task.attributes)[b]) {
 			// need to add logic here to only split numbers
 			return JSON.parse(task.attributes)[b].split('').join(' ');
 		}
 		else {
 			return "";
 		}


	});
	return parsedResponse;

}

