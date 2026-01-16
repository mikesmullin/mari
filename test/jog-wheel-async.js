/**
 * Async Jog Wheel Test
 * Tests non-blocking MIDI device reading
 */

import { readdir, open } from 'fs/promises';
import { join } from 'path';
import { createReadStream } from 'fs';

// List MIDI devices
async function listMidiDevices() {
  try {
    const entries = await readdir('/dev/snd');
    return entries
      .filter(name => name.startsWith('midiC'))
      .map(name => join('/dev/snd', name));
  } catch (err) {
    return [];
  }
}

// Parse MIDI CC for jog wheel
function parseJogWheel(status, controller, value) {
  if ((status & 0xF0) !== 0xB0) return null;
  if (controller !== 0x0A) return null;
  return value === 0x01 ? 'CW' : 'CCW';
}

// ============================================================
// Test 1: Using fs.promises.open with async read
// ============================================================
async function testAsyncFileHandle(devicePath, durationMs) {
  console.log('\n=== Test 1: fs.promises.open + async read ===');
  
  let fileHandle;
  let running = true;
  let eventCount = 0;
  
  try {
    fileHandle = await open(devicePath, 'r');
    console.log(`Opened: ${devicePath}`);
    
    const buffer = Buffer.alloc(3);
    const startTime = Date.now();
    
    // Set timeout to stop
    setTimeout(() => {
      running = false;
    }, durationMs);
    
    while (running) {
      try {
        const { bytesRead } = await fileHandle.read(buffer, 0, 3);
        
        if (bytesRead === 3) {
          const direction = parseJogWheel(buffer[0], buffer[1], buffer[2]);
          if (direction) {
            eventCount++;
            console.log(`  [${eventCount}] ${direction} @ ${Date.now() - startTime}ms`);
          }
        }
      } catch (err) {
        // EAGAIN or similar - no data available
        await new Promise(r => setTimeout(r, 5));
      }
    }
    
    console.log(`Result: ${eventCount} events in ${durationMs}ms`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    if (fileHandle) await fileHandle.close();
  }
  
  return eventCount;
}

// ============================================================
// Test 2: Using createReadStream (streaming approach)
// ============================================================
async function testReadStream(devicePath, durationMs) {
  console.log('\n=== Test 2: createReadStream ===');
  
  return new Promise((resolve) => {
    let eventCount = 0;
    const startTime = Date.now();
    
    const stream = createReadStream(devicePath, {
      highWaterMark: 3  // Read 3 bytes at a time (MIDI message size)
    });
    
    stream.on('data', (chunk) => {
      // Process each 3-byte MIDI message
      for (let i = 0; i + 2 < chunk.length; i += 3) {
        const direction = parseJogWheel(chunk[i], chunk[i + 1], chunk[i + 2]);
        if (direction) {
          eventCount++;
          console.log(`  [${eventCount}] ${direction} @ ${Date.now() - startTime}ms`);
        }
      }
    });
    
    stream.on('error', (err) => {
      console.error(`Stream error: ${err.message}`);
    });
    
    setTimeout(() => {
      stream.destroy();
      console.log(`Result: ${eventCount} events in ${durationMs}ms`);
      resolve(eventCount);
    }, durationMs);
  });
}

// ============================================================
// Test 3: Using setInterval polling with async read
// ============================================================
async function testPollingAsync(devicePath, durationMs) {
  console.log('\n=== Test 3: setInterval + async read ===');
  
  let fileHandle;
  let eventCount = 0;
  
  try {
    fileHandle = await open(devicePath, 'r');
    console.log(`Opened: ${devicePath}`);
    
    const buffer = Buffer.alloc(3);
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const poll = async () => {
        try {
          const { bytesRead } = await fileHandle.read(buffer, 0, 3);
          
          if (bytesRead === 3) {
            const direction = parseJogWheel(buffer[0], buffer[1], buffer[2]);
            if (direction) {
              eventCount++;
              console.log(`  [${eventCount}] ${direction} @ ${Date.now() - startTime}ms`);
            }
          }
        } catch (err) {
          // No data available
        }
      };
      
      const interval = setInterval(poll, 10);
      
      setTimeout(async () => {
        clearInterval(interval);
        console.log(`Result: ${eventCount} events in ${durationMs}ms`);
        if (fileHandle) await fileHandle.close();
        resolve(eventCount);
      }, durationMs);
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (fileHandle) await fileHandle.close();
    return 0;
  }
}

// ============================================================
// Test 4: Recursive setTimeout (non-blocking)
// ============================================================
async function testRecursiveTimeout(devicePath, durationMs) {
  console.log('\n=== Test 4: Recursive setTimeout ===');
  
  let fileHandle;
  let eventCount = 0;
  let running = true;
  
  try {
    fileHandle = await open(devicePath, 'r');
    console.log(`Opened: ${devicePath}`);
    
    const buffer = Buffer.alloc(3);
    const startTime = Date.now();
    
    const poll = async () => {
      if (!running) return;
      
      try {
        const { bytesRead } = await fileHandle.read(buffer, 0, 3);
        
        if (bytesRead === 3) {
          const direction = parseJogWheel(buffer[0], buffer[1], buffer[2]);
          if (direction) {
            eventCount++;
            console.log(`  [${eventCount}] ${direction} @ ${Date.now() - startTime}ms`);
          }
        }
      } catch (err) {
        // No data
      }
      
      if (running) {
        setTimeout(poll, 5);
      }
    };
    
    // Start polling
    setTimeout(poll, 0);
    
    // Wait for duration
    await new Promise((resolve) => {
      setTimeout(() => {
        running = false;
        resolve();
      }, durationMs);
    });
    
    console.log(`Result: ${eventCount} events in ${durationMs}ms`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    running = false;
    if (fileHandle) await fileHandle.close();
  }
  
  return eventCount;
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== Async Jog Wheel Tests ===');
  console.log('Spin the jog wheel during each test!\n');
  
  const devices = await listMidiDevices();
  if (devices.length === 0) {
    console.log('ERROR: No MIDI devices found in /dev/snd/');
    return;
  }
  
  console.log('Available devices:', devices);
  
  const devicePath = devices.find(d => d.includes('midiC4')) || devices[devices.length - 1];
  console.log(`Using: ${devicePath}`);
  
  const testDuration = 5000; // 5 seconds per test
  
  // Run tests sequentially
  const results = {};
  
  console.log(`\nEach test runs for ${testDuration / 1000} seconds.`);
  console.log('Spin the jog wheel to generate events.\n');
  
  // Test 2: ReadStream (usually works best for device files)
  results.readStream = await testReadStream(devicePath, testDuration);
  await new Promise(r => setTimeout(r, 1000));
  
  // Test 4: Recursive setTimeout
  results.recursiveTimeout = await testRecursiveTimeout(devicePath, testDuration);
  await new Promise(r => setTimeout(r, 1000));
  
  // Test 3: Polling
  results.polling = await testPollingAsync(devicePath, testDuration);
  await new Promise(r => setTimeout(r, 1000));
  
  // Test 1: Async file handle (may block)
  // results.asyncFileHandle = await testAsyncFileHandle(devicePath, testDuration);
  
  console.log('\n=== Summary ===');
  for (const [name, count] of Object.entries(results)) {
    console.log(`${name}: ${count} events`);
  }
}

main().catch(console.error);
