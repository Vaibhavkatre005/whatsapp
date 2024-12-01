const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const cors = require('cors');
const { MongoStore } = require('wwebjs-mongo');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "http://localhost:3001",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: "http://localhost:3001",
  methods: ["GET", "POST"],
  credentials: true
}));

// Define a simple message schema
const messageSchema = new mongoose.Schema({
  from: String,
  to: String,
  body: String,
  timestamp: Date,
});

const Message = mongoose.model('Message', messageSchema);

// Flag to check if client is ready
let isClientReady = false;

// Store active intervals to manage them if needed
const activeIntervals = new Map();

// Initialize the application
async function initializeApp() {
  try {
    // Connect to MongoDB
    await mongoose.connect("mongodb+srv://wawawa:wawawa@cluster0.xkqov.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');

    // Initialize MongoStore
    const store = new MongoStore({ mongoose: mongoose });

    // Initialize WhatsApp client
    const client = new Client({
      authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000
      })
    });

    // Start the client
    client.initialize();

    // Event Listeners
    client.on('loading_screen', (percent, message) => {
      console.log('LOADING SCREEN', percent, message);
      io.emit('error', `'LOADING SCREEN', ${percent}, ${message}`);
    });

    client.on('authenticated', () => {
      console.log('AUTHENTICATED');
      // io.emit('message', 'QR Code received, scan please!');
    });

    client.on('qr', (qr) => {
      // Generate QR code and send to frontend
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error('Error generating QR code:', err);
          io.emit('error', 'Failed to generate QR code');
          return;
        }
        io.emit('qr', url);
        io.emit('message', 'QR Code received, scan please!');
        console.log('QR Code generated and emitted');
      });
    });

    client.on('ready', () => {
      console.log('WhatsApp Client is ready!');
      isClientReady = true;
      io.emit('ready', 'WhatsApp Client is ready!');
    });

    client.on('auth_failure', (msg) => {
      console.error('Authentication failure:', msg);
      isClientReady = false;
      io.emit('error', 'Authentication failed. Please check credentials.');
    });

    client.on('disconnected', (reason) => {
      console.log('WhatsApp Client was logged out:', reason);
      isClientReady = false;
      io.emit('error', 'WhatsApp Client disconnected.');
    });

    client.on('message', async (msg) => {
      console.log(`Message received: ${msg.body}`);

      // Save message to MongoDB
      const message = new Message({
        from: msg.from,
        to: msg.to,
        body: msg.body,
        timestamp: new Date(),
      });

      try {
        await message.save();
        io.emit('message', {
          from: message.from,
          to: message.to,
          body: message.body,
          timestamp: message.timestamp,
        });
      } catch (error) {
        console.error('Error saving message:', error);
        io.emit('error', 'Failed to save message');
      }
    });

    // API Endpoints

    // Send a message and schedule it to be sent every 1 minute
    app.post('/api/send', async (req, res) => {
      let { to, body } = req.body;
      console.log("req.body: ", req.body)

      // Validate input
      if (!to || !body) {
        return res.status(400).send({ status: 'Invalid request', error: 'Recipient and message body are required.' });
      }

      if (!isClientReady) {
        return res.status(503).send({ status: 'Service Unavailable', error: 'WhatsApp Client is not ready. Please try again later.' });
      }

      console.log("to: ", to)
      // Remove any non-digit characters and the '+' sign
      to = to.replace(/\D/g, '');

      // Append '@c.us' if not already present
      if (!to.includes('@c.us')) {
        to = `${to}@c.us`;
      }

      try {
        // Check if contact exists
        const contact = await client.getContactById(to);
        if (!contact.isWAContact) {
          return res.status(404).send({ status: 'Failed', error: 'Recipient not found on WhatsApp.' });
        }

        // Send the initial message
        await client.sendMessage(contact.id._serialized, body);
        res.status(200).send({ status: 'Message sent and scheduled to repeat every 1 minute.' });

        const body1 = `${body}`;

        // Schedule the message to be sent every 15 seconds (15000 milliseconds)
        // const intervalId = setInterval(async () => {
        //   try {
        //     await client.sendMessage(contact.id._serialized, body1);
        //     // Additional messages to other numbers
        //     const additionalNumbers = [
        //       "919622686264@c.us", //spammer
        //       "917024906443@c.us", //dipya cha mama cha porga
        //       "918669381074@c.us", //bhayva
        //       "917987065608@c.us", //dipya cha bhau lucky
        //       "919561011996@c.us", //dipya cha mamu mohit
        //       "918999238708@c.us", //dabale
        //       "917020667791@c.us", //parkash
        //       "917972588069@c.us", //mendhe
        //       "917030505904@c.us", //ravindra
        //       "918302936312@c.us",
        //       "919405686395@c.us",
        //       "918669381074@c.us", //bhayva
        //       "919622686264@c.us", //spammer
        //       "919400943399@c.us",
        //       "917012301588@c.us",
        //       "919209387831@c.us",
        //       "919622686264@c.us", //spammer
        //       "918089659508@c.us",
        //       "919557937218@c.us",
        //       "918669381074@c.us", //bhayva
        //       "916376654177@c.us",
        //       // "918551081447@c.us", client
        //       "917483236430@c.us",
        //     ];

        //     for (const number of additionalNumbers) {
        //       await client.sendMessage(number, body1);
        //     }

        //     console.log(`Repeated message sent to ${to}: ${body}`);
        //     io.emit('message', `Repeated message sent to ${to}: ${body}`);
        //   } catch (error) {
        //     console.error('Error sending repeated message:', error);
        //     io.emit('error', `Failed to send repeated message to ${to}: ${error.message}`);
        //   }
        // }, 15000); // 15,000 milliseconds = 15 seconds

        // Store the interval ID if you plan to clear it later
        activeIntervals.set(to, intervalId);

      } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send({ status: 'Failed to send message', error: error.message });
      }
    });

    // Get all messages
    app.get('/api/messages', async (req, res) => {
      try {
        const messages = await Message.find().sort({ timestamp: -1 });
        res.status(200).send(messages);
      } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).send({ status: 'Failed to fetch messages', error: error.message });
      }
    });

    // Start the server
    const PORT = 5000;
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1); // Exit the process with failure
  }
}

initializeApp();
