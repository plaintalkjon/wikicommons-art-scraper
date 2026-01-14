#!/usr/bin/env node
/**
 * Migrate account_type from 'philosopher' to 'quote'
 * 
 * Usage:
 *   npm run migrate-philosopher-to-quote
 *   or
 *   tsx src/cli-migrate-philosopher-to-quote.ts
 */

import { supabase, config } from './config';

async function migratePhilosopherToQuote(): Promise<void> {
  console.log('🔄 Migrating account_type from "philosopher" to "quote"');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Step 1: Try to update the constraint via RPC (if available)
    console.log('📝 Step 1: Updating database constraint...');
    const updateConstraintSQL = `
      ALTER TABLE mastodon_accounts 
      DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;
      
      ALTER TABLE mastodon_accounts 
      ADD CONSTRAINT mastodon_accounts_account_type_check 
      CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh'));
    `;

    let constraintUpdated = false;
    try {
      const { error } = await supabase.rpc('exec_sql', { 
        sql: updateConstraintSQL 
      } as any);
      
      if (!error) {
        console.log('   ✅ Constraint updated successfully via RPC');
        constraintUpdated = true;
      } else {
        console.log(`   ⚠️  RPC not available: ${error.message}`);
      }
    } catch (err: any) {
      console.log(`   ⚠️  Could not update constraint via RPC: ${err.message}`);
    }

    if (!constraintUpdated) {
      console.log('');
      console.log('   ⚠️  Constraint update requires manual SQL execution');
      console.log('   Attempting to update accounts anyway (constraint may already allow "quote")...');
      console.log('');
    }

    // Step 2: Check how many accounts need to be updated
    console.log('');
    console.log('📊 Step 2: Checking existing accounts...');
    const { data: philosopherAccounts, error: checkError } = await supabase
      .from('mastodon_accounts')
      .select('id, account_username, account_type, author_id, active')
      .eq('account_type', 'philosopher');

    if (checkError) {
      throw new Error(`Failed to check accounts: ${checkError.message}`);
    }

    const count = philosopherAccounts?.length || 0;
    console.log(`   Found ${count} account(s) with account_type='philosopher'`);

    if (count === 0) {
      console.log('   ✅ No accounts to update (migration may already be complete)');
      console.log('');
      
      // Verify current state
      const { data: allAccounts } = await supabase
        .from('mastodon_accounts')
        .select('account_type')
        .in('account_type', ['philosopher', 'quote']);
      
      const byType = (allAccounts || []).reduce((acc: Record<string, number>, account) => {
        acc[account.account_type] = (acc[account.account_type] || 0) + 1;
        return acc;
      }, {});

      console.log('📊 Current account type distribution:');
      Object.entries(byType).forEach(([type, count]) => {
        console.log(`   - ${type}: ${count}`);
      });
      return;
    }

    // Step 3: Update accounts
    console.log('');
    console.log('🔄 Step 3: Updating accounts...');
    const { data: updatedAccounts, error: updateError } = await supabase
      .from('mastodon_accounts')
      .update({ account_type: 'quote' })
      .eq('account_type', 'philosopher')
      .select('id, account_username, account_type');

    if (updateError) {
      throw new Error(`Failed to update accounts: ${updateError.message}`);
    }

    console.log(`   ✅ Updated ${updatedAccounts?.length || 0} account(s)`);
    
    if (updatedAccounts && updatedAccounts.length > 0) {
      console.log('');
      console.log('   Updated accounts:');
      updatedAccounts.forEach(acc => {
        console.log(`     - ${acc.account_username} (ID: ${acc.id})`);
      });
    }

    // Step 4: Verify the changes
    console.log('');
    console.log('✅ Step 4: Verifying migration...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('mastodon_accounts')
      .select('account_type')
      .in('account_type', ['philosopher', 'quote']);

    if (verifyError) {
      throw new Error(`Failed to verify: ${verifyError.message}`);
    }

    const byType = (verifyData || []).reduce((acc: Record<string, number>, account) => {
      acc[account.account_type] = (acc[account.account_type] || 0) + 1;
      return acc;
    }, {});

    console.log('   Account type distribution:');
    Object.entries(byType).forEach(([type, count]) => {
      const icon = type === 'quote' ? '✅' : '⚠️';
      console.log(`     ${icon} ${type}: ${count}`);
    });

    if (byType['philosopher'] && byType['philosopher'] > 0) {
      console.log('');
      console.log('   ⚠️  Warning: Some accounts still have account_type="philosopher"');
      console.log('      This may indicate a constraint issue or concurrent updates.');
    } else {
      console.log('');
      console.log('   ✅ Migration complete! All accounts now use account_type="quote"');
    }

    console.log('');
    console.log('═'.repeat(70));
    console.log('✅ Migration completed successfully');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('');
    console.error('❌ Migration failed:');
    console.error(`   ${error.message}`);
    console.error('');
    console.error('💡 If the constraint update failed, please run the SQL manually:');
    console.error('   1. Go to Supabase Dashboard → SQL Editor');
    console.error('   2. Run: migrate-philosopher-to-quote.sql');
    console.error('');
    process.exit(1);
  }
}

// Run migration
migratePhilosopherToQuote().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

