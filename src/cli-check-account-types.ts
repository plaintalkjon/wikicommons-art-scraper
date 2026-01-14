#!/usr/bin/env node
/**
 * Check current account types in the database
 */

import { supabase } from './config';

async function checkAccountTypes(): Promise<void> {
  console.log('🔍 Checking account types in database...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    const { data: accounts, error } = await supabase
      .from('mastodon_accounts')
      .select('account_type, account_username, id, active')
      .order('account_type')
      .order('account_username');

    if (error) {
      throw new Error(`Failed to query accounts: ${error.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.log('⚠️  No accounts found');
      return;
    }

    // Group by account type
    const byType: Record<string, typeof accounts> = {};
    accounts.forEach(acc => {
      if (!byType[acc.account_type]) {
        byType[acc.account_type] = [];
      }
      byType[acc.account_type].push(acc);
    });

    console.log(`📊 Found ${accounts.length} total account(s)`);
    console.log('');
    console.log('Account types in database:');
    console.log('─'.repeat(70));

    Object.entries(byType).forEach(([type, typeAccounts]) => {
      console.log(`\n${type.toUpperCase()}: ${typeAccounts.length} account(s)`);
      typeAccounts.forEach(acc => {
        const status = acc.active ? '✅' : '❌';
        console.log(`  ${status} ${acc.account_username} (ID: ${acc.id})`);
      });
    });

    console.log('');
    console.log('═'.repeat(70));
    console.log('Expected account types: artist, tag, quote, mtg, yugioh');
    console.log('');

    const unexpectedTypes = Object.keys(byType).filter(
      type => !['artist', 'tag', 'quote', 'philosopher', 'mtg', 'yugioh'].includes(type)
    );

    if (unexpectedTypes.length > 0) {
      console.log('⚠️  Unexpected account types found:');
      unexpectedTypes.forEach(type => {
        console.log(`   - ${type}`);
      });
      console.log('');
    }

    if (byType['philosopher']) {
      console.log('📝 Found "philosopher" accounts that need to be migrated to "quote"');
      console.log(`   Count: ${byType['philosopher'].length}`);
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkAccountTypes().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

