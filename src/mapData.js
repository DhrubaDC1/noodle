import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

const tagsOf = (row) => { try { return Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || '[]'); } catch { return []; } };
export const topicName = (tag) => tag.split('-').map((word) => word === 'project' ? 'projects' : word).join(' ').replace(/^./, (c) => c.toUpperCase());

export function topicsFrom(thoughts) {
  const groups = new Map();
  for (const thought of thoughts) {
    if (thought.deleted || thought.status === 'archived') continue;
    for (const tag of new Set(tagsOf(thought))) {
      if (!groups.has(tag)) groups.set(tag, { tag, name: topicName(tag), count: 0, types: {}, ids: [] });
      const group = groups.get(tag);
      group.count++; group.ids.push(thought.id);
      if (thought.type) group.types[thought.type] = (group.types[thought.type] || 0) + 1;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 12)
    .map(({ types, ...group }) => ({ ...group, type: Object.entries(types).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'idea' }));
}

export function topicEdges(topics, links, cap = 3) {
  const candidates = [];
  for (let i = 0; i < topics.length; i++) for (let j = i + 1; j < topics.length; j++) {
    const a = new Set(topics[i].ids), b = new Set(topics[j].ids);
    const pairs = new Set([...a].filter((id) => b.has(id)).map((id) => `tag:${id}`));
    for (const link of links) if (!link.deleted && ((a.has(link.from_id) && b.has(link.to_id)) || (a.has(link.to_id) && b.has(link.from_id)))) pairs.add([link.from_id, link.to_id].sort().join(':'));
    if (pairs.size) candidates.push({ source: topics[i].tag, target: topics[j].tag, strength: pairs.size });
  }
  candidates.sort((a, b) => b.strength - a.strength || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const degree = new Map();
  return candidates.filter((edge) => {
    if ((degree.get(edge.source) || 0) >= cap || (degree.get(edge.target) || 0) >= cap) return false;
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    return true;
  });
}

export function neighbourhood(centerId, thoughts, links) {
  const available = new Map(thoughts.filter((t) => !t.deleted).map((t) => [t.id, t]));
  const center = available.get(centerId);
  if (!center) return { nodes: [], edges: [] };
  const adjacent = (id) => links.filter((l) => !l.deleted && (l.from_id === id || l.to_id === id))
    .map((l) => ({ ...l, other: l.from_id === id ? l.to_id : l.from_id }))
    .filter((l) => available.has(l.other)).sort((a, b) => b.strength - a.strength || a.other.localeCompare(b.other));
  const seen = new Set([centerId]);
  const nodes = [{ ...center, hop: 0 }], edges = [];
  const first = adjacent(centerId).filter((l) => !seen.has(l.other)).slice(0, 6);
  first.forEach((link) => seen.add(link.other));
  for (const link of first) { nodes.push({ ...available.get(link.other), hop: 1 }); edges.push({ source: centerId, target: link.other, ...link, hop: 1 }); }
  for (const parent of first) {
    let added = 0;
    for (const link of adjacent(parent.other)) {
      if (seen.has(link.other)) continue;
      seen.add(link.other); nodes.push({ ...available.get(link.other), hop: 2 });
      edges.push({ source: parent.other, target: link.other, ...link, hop: 2 });
      if (++added === 2) break;
    }
  }
  return { nodes, edges };
}

export function noodlePath(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
  const px = -dy / length * 12, py = dx / length * 12;
  return `M${a.x} ${a.y}C${a.x + dx / 3 + px} ${a.y + dy / 3 + py} ${a.x + dx * 2 / 3 - px} ${a.y + dy * 2 / 3 - py} ${b.x} ${b.y}`;
}

export function layoutMap(nodes, edges, width, height, thought = false) {
  const placed = nodes.map((node, i) => ({ ...node, x: width / 2 + Math.cos(i * 2.4) * (40 + i * 16), y: height / 2 + Math.sin(i * 2.4) * (40 + i * 16), radius: thought ? (node.hop === 0 ? 100 : node.hop === 1 ? 86 : 80) : 30 + 36 * Math.sqrt(node.count / Math.max(...nodes.map((n) => n.count))) }));
  if (!placed.length) return [];
  if (thought) { placed[0].fx = width / 2; placed[0].fy = height / 2; }
  let seed = 1;
  const sim = forceSimulation(placed).randomSource(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)).force('charge', forceManyBody().strength(-80)).force('center', thought ? null : forceCenter(width / 2, height / 2)).force('x', forceX(width / 2).strength(thought ? 0.01 : 0.08)).force('y', forceY(height / 2).strength(thought ? 0.01 : 0.08)).force('collision', forceCollide((n) => n.radius + 12).iterations(4)).force('link', forceLink(edges.map((e) => ({ source: e.source, target: e.target }))).id((n) => thought ? n.id : n.tag).distance(thought ? 230 : 150).strength(thought ? 0.8 : 0.2)).stop();
  for (let i = 0; i < 400; i++) sim.tick();
  // Thought cards are up to 190 wide: keep them on screen (pan still reaches the rest).
  if (thought) for (const n of placed) n.x = Math.max(95, Math.min(width - 95, n.x));
  return placed;
}
