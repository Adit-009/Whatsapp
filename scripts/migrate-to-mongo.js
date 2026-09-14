/**
 * One-time migration script: Import contacts from contacts.json into MongoDB.
 * 
 * Usage: node scripts/migrate-to-mongo.js
 * 
 * This script reads the existing public/data/contacts.json file and imports
 * all contacts into the MongoDB contacts collection.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import Contact from '../models/Contact.js';

const DATA_FILE = path.resolve('public/data/contacts.json');

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[Migration] MONGODB_URI is not set in .env file!');
    process.exit(1);
  }

  console.log('[Migration] Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('[Migration] Connected.');

  // Read existing contacts.json
  let contacts = [];
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    contacts = JSON.parse(raw);
    if (!Array.isArray(contacts)) contacts = [];
  } catch (err) {
    console.log('[Migration] No contacts.json found or file is empty. Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  if (contacts.length === 0) {
    console.log('[Migration] contacts.json is empty. Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  console.log(`[Migration] Found ${contacts.length} contacts to import.`);

  let imported = 0;
  let skipped = 0;

  for (const c of contacts) {
    try {
      // Check if phone already exists
      const existing = await Contact.findOne({ phone: c.phone });
      if (existing) {
        console.log(`  Skipped (duplicate): ${c.name} (${c.phone})`);
        skipped++;
        continue;
      }

      await Contact.create({
        name: c.name,
        phone: c.phone,
        lastSent: c.lastSent || null,
        status: c.status || 'idle'
      });
      console.log(`  Imported: ${c.name} (${c.phone})`);
      imported++;
    } catch (err) {
      console.error(`  Error importing ${c.name}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n[Migration] Complete! Imported: ${imported}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('[Migration] Fatal error:', err);
  process.exit(1);
});
