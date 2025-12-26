#!/usr/bin/env node
/**
 * Scrape Met Museum artworks by department/category
 * Uses Met API only (no Wikidata required)
 * 
 * Usage:
 *   npm run scrape-met-department -- --department "European Paintings"
 *   npm run scrape-met-department -- --departmentId 11
 *   npm run scrape-met-department -- --department "European Paintings" --limit 100
 *   npm run scrape-met-department -- --department "European Paintings" --dry-run
 */

import { getDepartments, getObjectIDsByDepartment, getAllObjectIDs, filterObjectIDsByDepartment } from './metmuseum-department';
import { fetchAndStoreFromMetOnly } from './pipeline-met-only';

interface Options {
  department?: string;
  departmentId?: number;
  limit?: number;
  dryRun?: boolean;
  maxUploads?: number;
}

async function main() {
  const args = process.argv.slice(2);
  const options: Options = {};
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--department' && args[i + 1]) {
      options.department = args[i + 1];
      i++;
    } else if (arg === '--departmentId' && args[i + 1]) {
      options.departmentId = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--max-uploads' && args[i + 1]) {
      options.maxUploads = parseInt(args[i + 1], 10);
      i++;
    }
  }
  
  console.log('Met Museum Department Scraper\n');
  
  // Get department ID
  let departmentId: number | undefined = options.departmentId;
  let departmentName: string | undefined = options.department;
  
  if (!departmentId && options.department) {
    console.log('Fetching departments...');
    const departments = await getDepartments();
    const matching = departments.find(
      d => d.displayName.toLowerCase() === options.department!.toLowerCase()
    );
    
    if (!matching) {
      console.error(`\n❌ Department not found: "${options.department}"`);
      console.log('\nAvailable departments:');
      departments.forEach(d => {
        console.log(`  ${d.departmentId}: ${d.displayName}`);
      });
      process.exit(1);
    }
    
    departmentId = matching.departmentId;
    departmentName = matching.displayName;
    console.log(`✓ Found department: ${departmentName} (ID: ${departmentId})\n`);
  } else if (departmentId && !departmentName) {
    console.log('Fetching departments...');
    const departments = await getDepartments();
    const matching = departments.find(d => d.departmentId === departmentId);
    if (matching) {
      departmentName = matching.displayName;
      console.log(`✓ Department: ${departmentName} (ID: ${departmentId})\n`);
    } else {
      console.log(`⚠ Department ID ${departmentId} not found in list, continuing anyway...\n`);
    }
  }
  
  if (!departmentId) {
    console.error('❌ Must specify either --department or --departmentId');
    process.exit(1);
  }
  
  // Get object IDs
  let objectIDs: number[] = [];
  
  try {
    console.log('Fetching object IDs for department...');
    objectIDs = await getObjectIDsByDepartment(departmentId);
    console.log(`✓ Found ${objectIDs.length} objects in department\n`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('403')) {
      console.log('⚠ Search endpoint blocked (403). Trying fallback method...\n');
      
      // Fallback: Get all objects and filter
      try {
        console.log('Fetching all object IDs...');
        const allObjectIDs = await getAllObjectIDs();
        console.log(`✓ Found ${allObjectIDs.length} total objects\n`);
        
        console.log('Filtering by department (this may take a while)...');
        objectIDs = await filterObjectIDsByDepartment(allObjectIDs, departmentId, departmentName, 10, 1000);
        console.log(`✓ Found ${objectIDs.length} objects in department after filtering\n`);
      } catch (fallbackErr) {
        console.error(`\n❌ Fallback method also failed: ${(fallbackErr as Error).message}`);
        console.error('Bot protection is blocking Met API access.');
        process.exit(1);
      }
    } else {
      console.error(`\n❌ Failed to get object IDs: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  
  if (objectIDs.length === 0) {
    console.log('⚠ No objects found in department');
    process.exit(0);
  }
  
  // Apply limit if specified
  if (options.limit && objectIDs.length > options.limit) {
    console.log(`Limiting to first ${options.limit} objects...\n`);
    objectIDs = objectIDs.slice(0, options.limit);
  }
  
  // Process objects
  console.log(`Starting to process ${objectIDs.length} objects...\n`);
  const result = await fetchAndStoreFromMetOnly({
    departmentId,
    departmentName,
    objectIDs,
    limit: options.limit,
    dryRun: options.dryRun,
    maxUploads: options.maxUploads,
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('Final Results');
  console.log('='.repeat(60));
  console.log(`  Attempted: ${result.attempted}`);
  console.log(`  Uploaded: ${result.uploaded} ✓`);
  console.log(`  Skipped: ${result.skipped}`);
  console.log(`  Errors: ${result.errors.length}`);
  console.log('='.repeat(60) + '\n');
  
  if (result.errors.length > 0) {
    console.log('Errors:');
    result.errors.slice(0, 10).forEach(err => {
      console.log(`  - ${err.title}: ${err.message}`);
    });
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
