require('dotenv').config();

const app = require('./app');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const server = app.listen(port, host, () => {
    console.log(`VitalScan running at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
    console.log('Phone scanning uses the HTTPS deployment and LiveKit. Run npm run worker on the processing Mac.');
});

server.on('error', (error) => {
    console.error(`Unable to start VitalScan on ${host}:${port}`);
    console.error(error.message);
    process.exitCode = 1;
});
