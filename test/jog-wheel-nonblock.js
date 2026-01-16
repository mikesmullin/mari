/**
 * Non-blocking Jog Wheel Test
 * Uses O_NONBLOCK flag for true async behavior
 */

import { readdir } from 'fs/promises';
import { open as openCb, read as readCb, close as closeCb, constants } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const openAsync = promisify(openCb);
const readAsync = promisify(readCb);
const closeAsync = promisify(closeCb);

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
// Test: Non-blocking read with O_NONBLOCK
// ============================================================
async function testNonBlocking(devicePath, durationMs) {
  console.log('\n=== Test: O_NONBLOCK + polling ===');
  
  let fd;
  let eventCount = 0;
  let running = true;
  
  try {
    // Open with O_RDONLY | O_NONBLOCK
    fd = await openAsync(devicePath, constants.O_RDONLY | constants.O_NONBLOCK);
    console.log(`Opened: ${devicePath} (fd=${fd})`);
    
    const buffer = Buffer.alloc(3);
    const startTime = Date.now();
    
    const poll = () => {
      if (!running) return;
      
      // Use callback-based read for non-blocking
      readCb(fd, buffer, 0, 3, null, (err, bytesRead) => {
        if (!err && bytesRead === 3) {
          const direction = parseJogWheel(buffer[0], buffer[1], buffer[2]);
          if (direction) {
            eventCount++;
            console.log(`  [${eventCount}] ${direction} @ ${Date.now() - startTime}ms`);
          }
        }
        // EAGAIN means no data available - that's fine
        
        if (running) {
          setTimeout(poll, 5);
        }
      });
    };
    
    // Start polling
    poll();
    
    // Wait for duration
    await new Promise((resolve) => {
      setTimeout(() => {
        running = false;
        setTimeout(resolve, 100); // Give time for last poll to complete
      }, durationMs);
    });
    
    console.log(`Result: ${eventCount} events in ${durationMs}ms`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    running = false;
    if (fd !== undefined) {
      try {
        await closeAsync(fd);
      } catch (e) {}
    }
  }
  
  return eventCount;
}

// ============================================================
// Test: Sync read in worker-like loop (for comparison)
// ============================================================
async function testSyncInLoop(devicePath, durationMs) {
  console.log('\n=== Test: Sync read (original approach) ===');
  
  const { openSync, readSync, closeSync } = await import('fs');
  
  let fd;
  let eventCount = 0;
  
  try {
    fd = openSync(devicePath, 'r');
    console.log(`Opened: ${devicePath}`);
    
    const buffer = Buffer.alloc(3);
    const startTime = Date.now();
    const endTime = startTime + durationMs;
    
    // This will block the event loop!
    while (Date.now() < endTime) {
      try {
        const bytesRead = readSync(fd, buffer, 0, 3);
        
        if (bytesRead === 3) {
          const direction = parseJogWheel(buffer[0], buffer[1], buffer[2]);
          if (direction) {
            eventCount++;
            console.log(`  [${eventCount}] ${direction} @ ${Date.now() - startTime}ms`);
          }
        }
      } catch (err) {
        // EAGAIN - no data
      }
    }
    
    console.log(`Result: ${eventCount} events in ${durationMs}ms`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  
  return eventCount;
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== Non-blocking Jog Wheel Tests ===');
  console.log('Spin the jog wheel during each test!\n');
  
  const devices = await listMidiDevices();
  if (devices.length === 0) {
    console.log('ERROR: No MIDI devices found in /dev/snd/');
    return;
  }
  
  console.log('Available devices:', devices);
  
  const devicePath = devices.find(d => d.includes('midiC4')) || devices[devices.length - 1];
  console.log(`Using: ${devicePath}`);
  
  const testDuration = 5000;
  
  console.log(`\nEach test runs for ${testDuration / 1000} seconds.`);
  console.log('Spin the jog wheel to generate events.\n');
  
  const results = {};
  
  // Test non-blocking
  results.nonBlocking = await testNonBlocking(devicePath, testDuration);
  await new Promise(r => setTimeout(r, 1000));
  
  // Test sync (blocks event loop - just for comparison)
  // results.sync = await testSyncInLoop(devicePath, testDuration);
  
  console.log('\n=== Summary ===');
  for (const [name, count] of Object.entries(results)) {
    console.log(`${name}: ${count} events`);
  }
}

main().catch(console.error);
