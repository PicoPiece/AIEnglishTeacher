#!/usr/bin/env node
/**
 * Generate pre-loaded English learning audio content using EdgeTTS.
 *
 * Usage:
 *   node scripts/generate-starter-content.js
 *
 * Environment variables:
 *   MUSIC_DIR  - Output directory (default: ./data/music)
 *   DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME - MySQL connection
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const VOICE = 'en-US-AriaNeural';
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, '..', 'data', 'music');
let Communicate = null;

// --- Content definitions ---

const PHONICS = [
  { letter: 'A', sound: 'ah', word: 'Apple' },
  { letter: 'B', sound: 'buh', word: 'Ball' },
  { letter: 'C', sound: 'kuh', word: 'Cat' },
  { letter: 'D', sound: 'duh', word: 'Dog' },
  { letter: 'E', sound: 'eh', word: 'Elephant' },
  { letter: 'F', sound: 'fuh', word: 'Fish' },
  { letter: 'G', sound: 'guh', word: 'Goat' },
  { letter: 'H', sound: 'huh', word: 'Hat' },
  { letter: 'I', sound: 'ih', word: 'Ice cream' },
  { letter: 'J', sound: 'juh', word: 'Jelly' },
  { letter: 'K', sound: 'kuh', word: 'Kite' },
  { letter: 'L', sound: 'luh', word: 'Lion' },
  { letter: 'M', sound: 'muh', word: 'Monkey' },
  { letter: 'N', sound: 'nuh', word: 'Nest' },
  { letter: 'O', sound: 'oh', word: 'Orange' },
  { letter: 'P', sound: 'puh', word: 'Penguin' },
  { letter: 'Q', sound: 'kwuh', word: 'Queen' },
  { letter: 'R', sound: 'ruh', word: 'Rabbit' },
  { letter: 'S', sound: 'sss', word: 'Sun' },
  { letter: 'T', sound: 'tuh', word: 'Tiger' },
  { letter: 'U', sound: 'uh', word: 'Umbrella' },
  { letter: 'V', sound: 'vvv', word: 'Violin' },
  { letter: 'W', sound: 'wuh', word: 'Water' },
  { letter: 'X', sound: 'ks', word: 'X-ray' },
  { letter: 'Y', sound: 'yuh', word: 'Yellow' },
  { letter: 'Z', sound: 'zzz', word: 'Zebra' },
];

const NUMBERS = [];
const NUMBER_WORDS = [
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen', 'Twenty',
];
for (let i = 0; i < 20; i++) {
  NUMBERS.push({
    num: i + 1,
    word: NUMBER_WORDS[i],
    spelling: NUMBER_WORDS[i].toUpperCase().split('').join(', '),
  });
}

const VOCAB_TOPICS = {
  dinosaurs: [
    { word: 'Dinosaur', sentence: 'Dinosaurs lived a long time ago.' },
    { word: 'T-Rex', sentence: 'T-Rex was a very big dinosaur.' },
    { word: 'Fossil', sentence: 'A fossil is a very old bone in the ground.' },
    { word: 'Egg', sentence: 'Baby dinosaurs came from eggs.' },
    { word: 'Tail', sentence: 'Some dinosaurs had a very long tail.' },
    { word: 'Teeth', sentence: 'T-Rex had very big, sharp teeth.' },
    { word: 'Herbivore', sentence: 'A herbivore eats only plants.' },
    { word: 'Carnivore', sentence: 'A carnivore eats meat.' },
    { word: 'Extinct', sentence: 'Dinosaurs are extinct. They are all gone.' },
    { word: 'Roar', sentence: 'The dinosaur went roar!' },
  ],
  space: [
    { word: 'Star', sentence: 'Stars shine bright in the sky at night.' },
    { word: 'Moon', sentence: 'The moon goes around the Earth.' },
    { word: 'Sun', sentence: 'The sun gives us light and warmth.' },
    { word: 'Planet', sentence: 'Earth is the planet where we live.' },
    { word: 'Rocket', sentence: 'A rocket flies up into space.' },
    { word: 'Astronaut', sentence: 'An astronaut is a person who goes to space.' },
    { word: 'Galaxy', sentence: 'There are many stars in a galaxy.' },
    { word: 'Orbit', sentence: 'The Earth orbits around the sun.' },
    { word: 'Alien', sentence: 'An alien comes from another planet.' },
    { word: 'Telescope', sentence: 'You can see stars with a telescope.' },
  ],
  animals: [
    { word: 'Dog', sentence: 'A dog is a friendly pet.' },
    { word: 'Cat', sentence: 'Cats like to sleep a lot.' },
    { word: 'Elephant', sentence: 'An elephant has a very long nose called a trunk.' },
    { word: 'Giraffe', sentence: 'A giraffe has a very long neck.' },
    { word: 'Penguin', sentence: 'Penguins live where it is very cold.' },
    { word: 'Dolphin', sentence: 'Dolphins are smart and swim in the ocean.' },
    { word: 'Butterfly', sentence: 'A butterfly has beautiful colorful wings.' },
    { word: 'Parrot', sentence: 'A parrot can talk and repeat words.' },
    { word: 'Turtle', sentence: 'A turtle carries its home on its back.' },
    { word: 'Rabbit', sentence: 'Rabbits have long ears and hop around.' },
  ],
};

// --- Helpers ---

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 120) || 'untitled';
}

async function generateAudio(text, outputPath) {
  if (!Communicate) {
    const mod = await import('edge-tts-universal');
    Communicate = mod.Communicate;
  }
  const comm = new Communicate(text, VOICE);
  const chunks = [];
  for await (const chunk of comm.stream()) {
    if (chunk.type === 'audio') {
      chunks.push(Buffer.from(chunk.data));
    }
  }
  fs.writeFileSync(outputPath, Buffer.concat(chunks));
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Main ---

async function main() {
  if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'parent_reader',
    password: process.env.DB_PASS || 'parent_readonly_pass',
    database: process.env.DB_NAME || 'xiaozhi_esp32_server',
    waitForConnections: true,
    connectionLimit: 2,
  });

  const items = [];

  // Phonics A-Z
  console.log('=== Generating Phonics A-Z ===');
  for (const p of PHONICS) {
    const text = `${p.letter}. ... ${p.sound}. ... ${p.letter} is for ${p.word}. ... ${p.word}!`;
    const title = `Phonics ${p.letter} - ${p.word}`;
    const filename = `${sanitizeFilename(title)}_phonics.mp3`;
    const outPath = path.join(MUSIC_DIR, filename);

    if (fs.existsSync(outPath)) {
      console.log(`  [skip] ${title} (already exists)`);
    } else {
      console.log(`  [gen]  ${title}`);
      try {
        await generateAudio(text, outPath);
        await sleep(500);
      } catch (err) {
        console.error(`  [ERR]  ${title}: ${err.message}`);
        continue;
      }
    }
    items.push({ title, artist: 'Teacher AI', category: 'phonics', filename, original: filename });
  }

  // Numbers 1-20
  console.log('\n=== Generating Numbers 1-20 ===');
  for (const n of NUMBERS) {
    const text = `${n.word}. ... ${n.spelling}. ... ${n.word}! ... The number is ${n.num}.`;
    const title = `Number ${n.num} - ${n.word}`;
    const filename = `${sanitizeFilename(title)}_numbers.mp3`;
    const outPath = path.join(MUSIC_DIR, filename);

    if (fs.existsSync(outPath)) {
      console.log(`  [skip] ${title} (already exists)`);
    } else {
      console.log(`  [gen]  ${title}`);
      try {
        await generateAudio(text, outPath);
        await sleep(500);
      } catch (err) {
        console.error(`  [ERR]  ${title}: ${err.message}`);
        continue;
      }
    }
    items.push({ title, artist: 'Teacher AI', category: 'vocabulary', filename, original: filename });
  }

  // Vocabulary by topic
  for (const [topic, words] of Object.entries(VOCAB_TOPICS)) {
    console.log(`\n=== Generating Vocabulary: ${topic} ===`);
    for (const v of words) {
      const text = `${v.word}. ... ${v.sentence} ... Can you say ${v.word}?`;
      const title = `${topic.charAt(0).toUpperCase() + topic.slice(1)} - ${v.word}`;
      const filename = `${sanitizeFilename(title)}_vocab.mp3`;
      const outPath = path.join(MUSIC_DIR, filename);

      if (fs.existsSync(outPath)) {
        console.log(`  [skip] ${title} (already exists)`);
      } else {
        console.log(`  [gen]  ${title}`);
        try {
          await generateAudio(text, outPath);
          await sleep(500);
        } catch (err) {
          console.error(`  [ERR]  ${title}: ${err.message}`);
          continue;
        }
      }
      items.push({ title, artist: 'Teacher AI', category: 'vocabulary', filename, original: filename });
    }
  }

  // Insert into DB
  console.log(`\n=== Inserting ${items.length} items into DB ===`);
  let inserted = 0, skipped = 0;
  for (const item of items) {
    const filePath = path.join(MUSIC_DIR, item.filename);
    if (!fs.existsSync(filePath)) { skipped++; continue; }
    const fileSize = fs.statSync(filePath).size;

    const [existing] = await pool.query(
      'SELECT id FROM parent_music WHERE filename = ? AND user_id = ?',
      [item.filename, 'system']
    );
    if (existing.length > 0) { skipped++; continue; }

    await pool.query(
      `INSERT INTO parent_music (user_id, title, artist, category, filename, original_name, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['system', item.title, item.artist, item.category, item.filename, item.original, fileSize]
    );
    inserted++;
  }

  console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
