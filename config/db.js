import mongoose from 'mongoose';

/**
 * Connect to MongoDB Atlas using the MONGODB_URI environment variable.
 * Logs connection events for debugging.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('[MongoDB] MONGODB_URI is not set in .env file!');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('[MongoDB] Connected to MongoDB Atlas successfully.');
  } catch (error) {
    console.error('[MongoDB] Connection error:', error.message);
    process.exit(1);
  }

  mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] Runtime connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('[MongoDB] Disconnected from MongoDB.');
  });
}

export default connectDB;
