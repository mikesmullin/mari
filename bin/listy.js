#!/usr/bin/env bun
/**
 * Listy CLI entry point
 */

import { main } from '../src/index.js';

// Get command line arguments (skip 'bun' and script path)
const args = process.argv.slice(2);

// Run main
main(args).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
