const express = require('express')
const axios = require("axios");
const app = express()
const port = process.env.PORT || 8080
var httpReq = require('request');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
var FormData = require('form-data');

var ClientOAuth2 = require('client-oauth2')


const oauthConfig = initServiceConfig();

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));

app.use(fileUpload({ createParentPath: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));



app.get('/classify', (request, response) => {
    response.send(`
        <html>
            <body>
                <h1> Please upload a pdf file for classification</h1>
                <form action="/classify" method="POST" enctype="multipart/form-data">
                    <input name="document" type="file">Choose file</input><br/>
                    <input type="submit">Send</input>
                </form>
            </body>
        </html>
    `);
});


app.post('/classify', async (request, response) => {

    //first download the file locally
    let uploadedFile = request.files.document;
    await uploadedFile.mv('./uploads/' + uploadedFile.name);

    let docId = uuidv4();
    let host = 'https://aiservices-trial-dc.cfapps.eu10.hana.ondemand.com';

    let token = await getAccessToken();

    try {
        let form = new FormData();
        form.append('document', fs.createReadStream('./uploads/' + uploadedFile.name));
        form.append('parameters', `{ "documentId": "${docId}", "lang": "en", "mimeType": "pdf" }`);
        form.append('modelVersion', 'latest');
        form.append('modelName', 'DocumentInfoRecord/AUT');

        axios({
            method: "post",
            url: `${host}/document-classification/v1/classification/models/DocumentInfoRecord%2FAUT/versions/latest/documents`,
            data: form,
            headers: { ...form.getHeaders(), Authorization: 'Bearer ' + token.accessToken }
        }).then(async (res) => {
            let docClassificationResponse = res.data;
            let attemptsLeft = 20;
            while (docClassificationResponse.status !== "SUCCEEDED" && attemptsLeft-- > 0) {
                await snooze(1000);
                try {
                    let res = await axios({
                        method: "get",
                        url: `${host}/document-classification/v1/classification/models/DocumentInfoRecord%2FAUT/versions/latest/documents/${docId}`,

                        headers: { Authorization: 'Bearer ' + token.accessToken }
                    })
                    docClassificationResponse = res.data;
                } catch (err) {
                    //todo, check if indeed code=409
                    console.log("Process not done yet, Wait 1 sec, will attempt " + attemptsLeft + " more times")
                }
            }
            if (attemptsLeft > 0) {
                //success
                response.type('json').send(JSON.stringify(docClassificationResponse.predictions, null, 4));
            } else {
                response.send("Error: timeout");
            }
        }, err => {
            console.log(err)
        });


    } catch (err) {
        console.log(err);
    }
});


app.listen(port, (err) => {
    if (err) {
        return console.log('something bad happened', err)
    }

    console.log(`server is listening on ${port}`)
});

async function getAccessToken() {
    var oAuth = new ClientOAuth2(oauthConfig);

    try {
        return await oAuth.credentials.getToken();
    } catch (error) {
        console.log('Access Token error', error.message);
    }
    return {};
}


function initServiceConfig() {

    if (!process.env.VCAP_SERVICES)
        return {
            clientId: '<clientid>',
            clientSecret: '<clientsecret>',
            accessTokenUri: '<uaa.url>/oauth/token'
        }

    console.log("Using bound service from VCAP_SERVICES");
    let VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);
    let docuClsSrv = VCAP_SERVICES["document-classification-trial"] && VCAP_SERVICES["document-classification-trial"][0]
    if (docuClsSrv) {
        return {
            clientId: docuClsSrv.credentials.uaa.clientid,
            clientSecret: docuClsSrv.credentials.uaa.clientsecret,
            accessTokenUri: docuClsSrv.credentials.uaa.url + '/oauth/token'
        };
    }
    throw "no-service-bound";
}

