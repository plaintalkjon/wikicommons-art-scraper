/**
 * Metropolitan Museum of Art API - Department-based scraping
 * Scrapes all artworks from a specific department without requiring Wikidata
 */

import { fetchObjectDetails, extractAllMetTags, MetObject } from './metmuseum';

const MET_API_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

export interface MetDepartment {
  departmentId: number;
  displayName: string;
}

/**
 * Get all departments from Met API
 */
export async function getDepartments(): Promise<MetDepartment[]> {
  const url = `${MET_API_BASE}/departments`;
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });
  
  if (!res.ok) {
    throw new Error(`Failed to fetch departments: ${res.status} ${res.statusText}`);
  }
  
  const data = await res.json() as { departments: MetDepartment[] };
  return data.departments || [];
}

/**
 * Get all object IDs for a specific department
 * Uses the search endpoint with departmentId parameter
 * 
 * Note: This endpoint may be blocked by bot protection (403). If it fails,
 * we'll need to fetch all objects and filter by department during processing.
 */
export async function getObjectIDsByDepartment(departmentId: number): Promise<number[]> {
  const url = `${MET_API_BASE}/search?q=*&departmentId=${departmentId}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.metmuseum.org/',
      },
    });
    
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error('403 Forbidden - Bot protection triggered. Cannot use search endpoint.');
      }
      throw new Error(`Failed to search department: ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json() as { total: number; objectIDs: number[] };
    return data.objectIDs || [];
  } catch (err) {
    if (err instanceof Error && err.message.includes('403')) {
      throw err; // Re-throw 403 errors
    }
    throw new Error(`Failed to get object IDs for department ${departmentId}: ${(err as Error).message}`);
  }
}

/**
 * Get all object IDs from Met API (fallback when search is blocked)
 * This returns ALL objects, which we'll filter by department during processing
 * 
 * WARNING: This endpoint may also be blocked or rate-limited
 */
export async function getAllObjectIDs(): Promise<number[]> {
  const url = `${MET_API_BASE}/objects`;
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.metmuseum.org/',
    },
  });
  
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('403 Forbidden - Bot protection triggered. Cannot use objects endpoint.');
    }
    throw new Error(`Failed to fetch all objects: ${res.status} ${res.statusText}`);
  }
  
  const data = await res.json() as { total: number; objectIDs: number[] };
  return data.objectIDs || [];
}

/**
 * Filter object IDs by department by fetching each object and checking its department
 * This is slower but works when search endpoint is blocked
 * 
 * Note: This requires a department name mapping since Met API objects only provide
 * department names, not IDs. Pass the department name for matching.
 */
export async function filterObjectIDsByDepartment(
  objectIDs: number[],
  departmentId: number,
  departmentName?: string,
  batchSize: number = 10,
  delayBetweenBatches: number = 1000
): Promise<number[]> {
  const matchingIDs: number[] = [];
  const totalBatches = Math.ceil(objectIDs.length / batchSize);
  
  // Get department name if not provided
  let targetDepartmentName: string | undefined = departmentName;
  if (!targetDepartmentName) {
    try {
      const departments = await getDepartments();
      const dept = departments.find(d => d.departmentId === departmentId);
      if (dept) {
        targetDepartmentName = dept.displayName;
      }
    } catch (err) {
      console.log(`  ⚠ Could not fetch department name for ID ${departmentId}`);
    }
  }
  
  if (!targetDepartmentName) {
    throw new Error(`Cannot filter by department ID ${departmentId} without department name`);
  }
  
  console.log(`  → Filtering ${objectIDs.length} objects by department "${targetDepartmentName}" (ID: ${departmentId})...`);
  console.log(`  → Processing in batches of ${batchSize} with ${delayBetweenBatches}ms delay`);
  
  const targetNameLower = targetDepartmentName.toLowerCase();
  
  for (let i = 0; i < objectIDs.length; i += batchSize) {
    const batch = objectIDs.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    
    console.log(`  → Batch ${batchNum}/${totalBatches} (${batch.length} objects)...`);
    
    const batchPromises = batch.map(async (objectID): Promise<number | null> => {
      try {
        const object = await fetchObjectDetails(objectID, 1, 500); // 1 retry, 500ms delay
        if (object && object.department) {
          // Match by department name (case-insensitive)
          const objectDeptLower = object.department.toLowerCase();
          if (objectDeptLower === targetNameLower || objectDeptLower.includes(targetNameLower)) {
            return objectID;
          }
        }
        return null;
      } catch (err) {
        // Silently skip errors (403s, etc.)
        return null;
      }
    });
    
    const results = await Promise.all(batchPromises);
    const valid = results.filter((id): id is number => id !== null);
    matchingIDs.push(...valid);
    
    // Delay between batches
    if (i + batchSize < objectIDs.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  console.log(`  ✓ Found ${matchingIDs.length} objects in department "${targetDepartmentName}"`);
  return matchingIDs;
}
