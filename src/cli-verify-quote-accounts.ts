#!/usr/bin/env node
/**
 * Verify quote accounts are set up correctly after migration
 */

import { supabase } from './config';

async function verifyQuoteAccounts(): Promise<void> {
  console.log('🔍 Verifying quote accounts setup...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Check quote accounts
    const { data: quoteAccounts, error: quoteError } = await supabase
      .from('mastodon_accounts')
      .select('id, account_username, account_type, author_id, active, last_posted_at')
      .eq('account_type', 'quote');

    if (quoteError) {
      throw new Error(`Failed to query quote accounts: ${quoteError.message}`);
    }

    console.log(`📊 Found ${quoteAccounts?.length || 0} quote account(s)`);
    console.log('');

    if (!quoteAccounts || quoteAccounts.length === 0) {
      console.log('⚠️  No quote accounts found');
      return;
    }

    // Verify each account
    for (const account of quoteAccounts) {
      console.log(`\n📝 Account: ${account.account_username}`);
      console.log(`   ID: ${account.id}`);
      console.log(`   Account Type: ${account.account_type} ${account.account_type === 'quote' ? '✅' : '❌'}`);
      console.log(`   Active: ${account.active ? '✅' : '❌'}`);
      console.log(`   Author ID: ${account.author_id || '⚠️  MISSING'}`);
      console.log(`   Last Posted: ${account.last_posted_at || 'NEVER'}`);

      // Check if author exists
      if (account.author_id) {
        const { data: author, error: authorError } = await supabase
          .from('quote_authors')
          .select('id, name, category')
          .eq('id', account.author_id)
          .single();

        if (authorError || !author) {
          console.log(`   ⚠️  Author not found: ${authorError?.message || 'Unknown error'}`);
        } else {
          console.log(`   ✅ Author: ${author.name} (Category: ${author.category || 'N/A'})`);

          // Check quotes available
          const { count: quoteCount, error: countError } = await supabase
            .from('quotes')
            .select('*', { count: 'exact', head: true })
            .eq('author_id', account.author_id);

          if (countError) {
            console.log(`   ⚠️  Error counting quotes: ${countError.message}`);
          } else {
            console.log(`   📚 Quotes available: ${quoteCount || 0}`);

            // Check unposted quotes
            const { count: unpostedCount } = await supabase
              .from('quotes')
              .select('*', { count: 'exact', head: true })
              .eq('author_id', account.author_id)
              .is('posted_at', null);

            console.log(`   📝 Unposted quotes: ${unpostedCount || 0}`);
          }
        }
      }
    }

    // Check for any remaining 'philosopher' accounts
    const { data: philosopherAccounts, error: philError } = await supabase
      .from('mastodon_accounts')
      .select('id, account_username, account_type')
      .eq('account_type', 'philosopher');

    if (!philError && philosopherAccounts && philosopherAccounts.length > 0) {
      console.log('');
      console.log('⚠️  WARNING: Found accounts still with account_type="philosopher":');
      philosopherAccounts.forEach(acc => {
        console.log(`   - ${acc.account_username} (ID: ${acc.id})`);
      });
    } else {
      console.log('');
      console.log('✅ No accounts with account_type="philosopher" found');
    }

    console.log('');
    console.log('═'.repeat(70));
    console.log('✅ Verification complete');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('');
    console.error('❌ Verification failed:');
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

verifyQuoteAccounts().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

