#!/usr/bin/env node
import { supabase } from './supabaseClient';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  const tagsInput = args.tags as string; // Comma-separated list of tags
  const token = args.token as string;
  const username = args.username as string;
  const baseUrl = (args['base-url'] as string) || 'https://mastodon.social';
  
  if (!tagsInput || !token) {
    console.error('Error: --tags and --token are required');
    console.error('Usage: npm run add-tag-bot -- --tags "Tag1,Tag2,Tag3" --token "access_token" [--username "@user@instance"] [--base-url "https://instance.com"]');
    console.error('\nExample: npm run add-tag-bot -- --tags "baroque,flemish baroque painting,italian baroque painting" --token "..." --username "@CuratedBaroque@mastodon.social"');
    process.exit(1);
  }
  
  // Parse comma-separated tags
  const tagNames = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
  
  if (tagNames.length === 0) {
    console.error('Error: At least one tag is required');
    process.exit(1);
  }
  
  console.log('\n=== Adding Tag Bot Account ===\n');
  console.log(`Tags: ${tagNames.join(', ')}`);
  console.log(`Base URL: ${baseUrl}`);
  if (username) {
    console.log(`Username: ${username}`);
  }
  console.log();
  
  try {
    // Step 1: Verify all tags exist
    console.log('Step 1: Verifying tags exist...');
    const { data: tags, error: tagsError } = await supabase
      .from('tags')
      .select('id, name')
      .in('name', tagNames);
    
    if (tagsError) {
      console.error('❌ Error fetching tags:', tagsError);
      process.exit(1);
    }
    
    if (!tags || tags.length === 0) {
      console.error('❌ No tags found');
      process.exit(1);
    }
    
    const foundTagNames = tags.map(t => t.name);
    const missingTags = tagNames.filter(t => !foundTagNames.includes(t));
    
    if (missingTags.length > 0) {
      console.error(`❌ Tags not found: ${missingTags.join(', ')}`);
      console.error('   Available tags can be found in the tags table.');
      process.exit(1);
    }
    
    console.log(`✓ Found ${tags.length} tag(s):`);
    tags.forEach(t => console.log(`   - ${t.name} (${t.id})`));
    
    // Step 2: Check for existing account (by username if provided, or create new)
    console.log('\nStep 2: Checking for existing account...');
    let accountId: string | null = null;
    
    if (username) {
      const { data: existing } = await supabase
        .from('mastodon_accounts')
        .select('id')
        .eq('account_username', username)
        .eq('account_type', 'tag')
        .single();
      
      if (existing) {
        accountId = existing.id;
        console.log('⚠️  Account already exists with this username. Updating...');
        const { error: updateError } = await supabase
          .from('mastodon_accounts')
          .update({
            mastodon_base_url: baseUrl,
            mastodon_access_token: token,
            account_type: 'tag',
            active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', accountId);
        
        if (updateError) {
          console.error('❌ Error updating account:', updateError);
          process.exit(1);
        }
        
        // Clear existing tags for this account
        await supabase
          .from('mastodon_account_tags')
          .delete()
          .eq('mastodon_account_id', accountId);
        
        console.log('✓ Account updated successfully!');
      }
    }
    
    if (!accountId) {
      console.log('✓ No existing account found. Creating new account...');
      
      // Step 3: Save account to database
      console.log('\nStep 3: Saving account to database...');
      const { data: account, error: insertError } = await supabase
        .from('mastodon_accounts')
        .insert({
          account_type: 'tag',
          mastodon_base_url: baseUrl,
          mastodon_access_token: token,
          account_username: username || null,
          active: true,
        })
        .select()
        .single();
      
      if (insertError || !account) {
        console.error('❌ Error saving account:', insertError);
        process.exit(1);
      }
      
      accountId = account.id;
      console.log('✓ Account saved successfully!');
    }
    
    // Step 4: Add tags to junction table
    console.log('\nStep 4: Adding tags to account...');
    const tagAssignments = tags.map(tag => ({
      mastodon_account_id: accountId!,
      tag_id: tag.id
    }));
    
    const { error: tagsInsertError } = await supabase
      .from('mastodon_account_tags')
      .upsert(tagAssignments, { onConflict: 'mastodon_account_id,tag_id' });
    
    if (tagsInsertError) {
      console.error('❌ Error adding tags:', tagsInsertError);
      process.exit(1);
    }
    
    console.log(`✓ Added ${tags.length} tag(s) to account`);
    
    // Step 5: Verify the account
    console.log('\nStep 5: Verifying account...');
    const { data: verifyAccount } = await supabase
      .from('mastodon_accounts')
      .select('id, account_type, active, account_username')
      .eq('id', accountId)
      .single();
    
    const { data: verifyTags } = await supabase
      .from('mastodon_account_tags')
      .select('tag_id, tags(name)')
      .eq('mastodon_account_id', accountId);
    
    if (verifyAccount) {
      console.log('✓ Account verified:');
      console.log(`   ID: ${verifyAccount.id}`);
      console.log(`   Type: ${verifyAccount.account_type}`);
      console.log(`   Active: ${verifyAccount.active}`);
      if (verifyAccount.account_username) {
        console.log(`   Username: ${verifyAccount.account_username}`);
      }
      if (verifyTags) {
        console.log(`   Tags (${verifyTags.length}):`);
        verifyTags.forEach((vt: any) => {
          console.log(`     - ${vt.tags?.name || 'Unknown'}`);
        });
      }
    }
    
    console.log('\n=== Complete! ===\n');
    console.log(`✓ Tag bot account added with ${tags.length} tag(s): ${tagNames.join(', ')}`);
    console.log('\nThe account will automatically be included in the cron job rotation.');
    console.log('No additional scheduling needed - it will post every 6 hours with other accounts.');
    console.log('\nTo add more tags later, you can insert into mastodon_account_tags table.\n');
    
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main().catch(console.error);


