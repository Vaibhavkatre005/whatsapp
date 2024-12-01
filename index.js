const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // For authentication
const bcrypt = require('bcrypt'); // For password hashing
const { MongoStore } = require('wwebjs-mongo');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "https://wa-client-seven.vercel.app/",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: "https://wa-client-seven.vercel.app/",
  methods: ["GET", "POST"],
  credentials: true,
}));

// JWT secret key
const JWT_SECRET = 'your_jwt_secret_key';

// MongoDB schemas
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  sessionId: String, // Store session ID for the WhatsApp client
});

const User = mongoose.model('User', userSchema);

// Middleware to authenticate user
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ error: 'Invalid token' });
  }
};

const initializeClient = (userId, store) => {
  const client = new Client({
    authStrategy: new RemoteAuth({
      store: store,
      clientId: userId, // Unique client ID for the user
      backupSyncIntervalMs: 60000, // Minimum interval: 1 minute
    }),
  });

  client.initialize();

  client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      if (!err) {
        console.log(`QR code generated for user: ${userId}`);
        io.emit('qr', { userId, qrCode: url }); // Emit QR code to frontend
        
      }
    });
  });

  client.on('ready', () => {
    console.log(`WhatsApp client ready for user: ${userId}`);
    io.emit('ready', { userId, message: 'WhatsApp client is ready!' });
  });

  client.on('authenticated', () => {
    console.log(`WhatsApp client authenticated for user: ${userId}`);
  });

  client.on('auth_failure', (msg) => {
    console.error(`Authentication failure for user: ${userId}:`, msg);
  });

  client.on('disconnected', (reason) => {
    console.log(`WhatsApp client disconnected for user: ${userId}. Reason:`, reason);
  });

  return client;
};


// Initialize the application
async function initializeApp() {
  try {
    // Connect to MongoDB
    await mongoose.connect("mongodb+srv://wawawa:wawawa@cluster0.xkqov.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');

    // Initialize WhatsApp clients for multiple users
    const clients = new Map(); // Map to store user-specific clients

    // User authentication routes
    app.post('/api/register', async (req, res) => {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).send({ error: 'Username and password are required' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      try {
        const user = await User.create({ username, password: hashedPassword });
        res.status(201).send({ message: 'User registered successfully' });
      } catch (error) {
        res.status(400).send({ error: 'Username already exists' });
      }
    });

    app.post('/api/login', async (req, res) => {
      const { username, password } = req.body;

      const user = await User.findOne({ username });
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).send({ error: 'Invalid username or password' });
      }

      const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
      res.status(200).send({ token });
    });

    // Initialize WhatsApp client for the logged-in user
    app.post('/api/initialize', authenticate, async (req, res) => {
      const userId = req.user.id;
    
      if (clients.has(userId)) {
        return res.status(200).send({ message: 'WhatsApp client already initialized' });
      }
    
      const store = new MongoStore({ mongoose: mongoose });
    
      if (process.listenerCount('SIGINT') === 0) {
        process.on('SIGINT', () => process.exit(0));
      }
    
      const client = initializeClient(userId, store);
    
      clients.set(userId, client);
      res.status(200).send({ message: 'WhatsApp client initialized' });
    });

    // Send message for a specific user
    app.post('/api/send', authenticate, async (req, res) => {
      const { to, body } = req.body;
      const userId = req.user.id;

      if (!clients.has(userId)) {
        return res.status(503).send({ error: 'WhatsApp Client is not initialized for this user' });
      }

      const client = clients.get(userId);
      console.log(to)

      try {
        await client.sendMessage(to, body);
        res.status(200).send({ message: 'Message sent successfully' });
      } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send({ error: 'Failed to send message' });
      }
    });

    // Start the server
    const PORT = 5000;
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1);
  }
}

initializeApp();
