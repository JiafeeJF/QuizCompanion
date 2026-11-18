import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wuli-baodian';

let connected = false;

export async function connectDB() {
  if (connected) return mongoose.connection;
  mongoose.set('strictQuery', true);
  await mongoose.connect(MONGO_URI);
  connected = true;
  console.log('[db] MongoDB 已连接');
  return mongoose.connection;
}
