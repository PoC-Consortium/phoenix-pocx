const fs = require('fs');

const keysToRemove = [
  'coin_type',
  'create_new_wallet',
  'create_wallet_message',
  'exit_confirm_mining',
  'exit_confirm_mining_plotting',
  'exit_confirm_plotting',
  'import_wif_confirm_message',
  'import_wif_confirm_title',
  'max_10_characters',
  'mining_flush',
  'mining_flush_tooltip',
  'no_wallets',
  'node_starting_message',
  'node_starting_title',
  'switch_to_wallet',
  'syncing',
  'wallet_info'
];

const files = fs.readdirSync('.').filter(f => f.endsWith('.json') && f !== 'en.json');

files.forEach(file => {
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  let removed = 0;

  keysToRemove.forEach(key => {
    if (content[key] !== undefined) {
      delete content[key];
      removed++;
    }
  });

  if (removed > 0) {
    fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
    console.log(`${file}: removed ${removed} keys`);
  }
});

console.log('\nDone!');
