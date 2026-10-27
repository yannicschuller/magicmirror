// Command line helpers, run inside the container:
//   docker compose exec magicmirror node src/cli.js passwd <username>
// The password is read from stdin (prompted when interactive).
import readline from 'node:readline';
import { setPassword, validateCredentials } from './auth.js';

async function readPassword(prompt) {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.split('\n')[0];
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.includes(prompt) ? s : '');
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const [cmd, username = 'admin'] = process.argv.slice(2);
if (cmd !== 'passwd') {
  console.log('Usage: node src/cli.js passwd <username>');
  process.exit(cmd ? 1 : 0);
}
const password = await readPassword(`Password for ${username}: `);
const err = validateCredentials(username, password);
if (err) {
  console.error(err);
  process.exit(1);
}
setPassword(username, password);
console.log(`Password for "${username}" saved. Existing sessions of this user are signed out.`);
process.exit(0);
