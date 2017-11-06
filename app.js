/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/** Forked version by Barqawiz **/
'use strict';

var express = require('express'); // app server
var request = require('request');//Http requests
var bodyParser = require('body-parser'); // parser for post requests
var Conversation = require('watson-developer-cloud/conversation/v1'); // watson sdk

var app = express();
/*contextCash: save context through conversation when come from facebook or
any third party messanger, working on enhanced version that clear context after x time*/
var contextCash = {}
// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

// Create the service wrapper
var conversation = new Conversation({
  // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  'username': process.env.CONVERSATION_USERNAME,
  'password': process.env.CONVERSATION_PASSWORD,
  'version_date': '2017-05-26'
});

//Endpoint to handle bot request
app.get('/api/bot', function(req, res) {

  var user_text = req.param('text') || '<empty>'
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  var check_status = process.env.GET_ACTIVE || 'OFF'
  if (!workspace || workspace === '<workspace-id>' || user_text === '<empty>' || check_status === 'OFF') {
    return "";
  }

  user_text = { text: user_text.toString("utf8") }
  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: user_text || {}
  };

  // Send the input to the conversation service
  conversation.message(payload, function(err, data) {
    if (err) {
      return res.status(err.code || 500).json(err);
    }
    if (data.output && data.output.text) {
      return data.output.text[0]
    } else {
      return "";
    }

  });
});
// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {

  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }

  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: req.body.input || {}
  };

  // Send the input to the conversation service
  conversation.message(payload, function(err, data) {
    if (err) {
      return res.status(err.code || 500).json(err);
    }

    return res.json(updateMessage(payload, data));

  });
});

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;
  if (!response.output) {
    response.output = {};
  } else {
    return response;
  }
  if (response.intents && response.intents[0]) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if (intent.confidence >= 0.75) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if (intent.confidence >= 0.5) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  return response;
}

//THIRD PARTY
// Subscribing the webhook
app.get('/webhook/', function (req, res) {
    if (req.query['hub.verify_token'] === process.env.FACEBOOK_VERIFY) {
        res.send(req.query['hub.challenge']);
    }
    res.send('Error, wrong validation token');
})

// Incoming messages reach this end point //
app.post('/webhook', (req, res) => {
  console.log('**webhook invoced')
  // Parse the request body from the POST
  let body = req.body;
  // Check the webhook event is from a Page subscription
  if (body.object === 'page') {
    // Iterate over each entry - there may be multiple if batched
    body.entry.forEach(function(entry) {

      // Gets the body of the webhook event
      let webhook_event = entry.messaging[0];
      //console.log(webhook_event);

      // Get the sender PSID
      let sender_psid = webhook_event.sender.id;
      //console.log('Sender PSID: ' + sender_psid);

      // Check if the event is a message or postback and
      // pass the event to the appropriate handler function
      if (webhook_event.message) {
        let ctx = {}
        ctx = contextCash[sender_psid] || ctx

        handleMessage(sender_psid, webhook_event.message, ctx);
      } else if (webhook_event.postback) {
        console.log('postback request in webhook')
      }

    });
    // Return a '200 OK' response to all events
    res.status(200).send('EVENT_RECEIVED');

  } else {
    // Return a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }

});

function handleMessage(sender_psid, received_message, contx) {

  // Check if the message contains text
  if (received_message.text) {
    console.log("inside check")

    let workspace = process.env.WORKSPACE_ID;
    let text = { text: "'"+received_message.text+"'" }
    let payload = {
      workspace_id: workspace,
      context:  contx || {},
      input: text || {}
    };

    // Send the input to the conversation service
    conversation.message(payload, function(err, data) {
      if (err) {
        return res.status(err.code || 500).json(err);
      }

      if (data.output && data.output.text) {

        let response = {
          "text": "'"+data.output.text[0]+"'"
        }
        callFacebookAPI(sender_psid, response);
        //cash last context with the user
        contextCash[sender_psid] = data.context
      } else {
        console.log("***response is empty: ***")
        return;
      }

    });
  }


}

function callFacebookAPI(sender_psid, response) {
  // Construct the message body
  let request_body = {
    "recipient": {
      "id": sender_psid
    },
    "message": response
  }

  // Send the HTTP request to the Messenger Platform
  request({
    "uri": "https://graph.facebook.com/v2.6/me/messages",
    "qs": { "access_token": process.env.FACEBOOK_TOKEN },
    "method": "POST",
    "json": request_body
  }, (err, res, body) => {
    if (!err) {
      console.log('message sent!')
    } else {
      console.error("Unable to send message:" + err);
    }
  });
}

module.exports = app;
