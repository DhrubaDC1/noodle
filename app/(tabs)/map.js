import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { layoutMap, neighbourhood, noodlePath, topicEdges, topicsFrom } from '../../src/mapData';
import { font, type, useTheme } from '../../src/theme';

const labels = { idea: 'ideas', project: 'projects', todo: 'to-dos', memory: 'memories', question: 'questions' };
const relationLabel = (value) => ({ 'same-project': 'Same project', 'follow-up': 'Follow-up', 'similar-idea': 'Similar idea', contradicts: 'Contradicts' })[value] || 'Related';

export default function MapScreen() {
  const db = useSQLiteContext(), { colors: c } = useTheme(), insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const [view, setView] = useState('topics'), [centerId, setCenterId] = useState(null);
  const [thoughts, setThoughts] = useState([]), [links, setLinks] = useState([]), [size, setSize] = useState({ width: 390, height: 600 });
  const tx = useSharedValue(0), ty = useSharedValue(0), zoom = useSharedValue(1);
  const startX = useSharedValue(0), startY = useSharedValue(0), startZoom = useSharedValue(1);
  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([
      db.getAllAsync(`SELECT t.id,t.text,t.status,t.created_at,a.title,a.type,a.tags FROM thoughts t LEFT JOIN analysis a ON a.thought_id=t.id WHERE t.deleted=0`),
      db.getAllAsync(`SELECT l.from_id,l.to_id,l.relation,l.strength,l.deleted,l.created_at FROM links l JOIN thoughts a ON a.id=l.from_id JOIN thoughts b ON b.id=l.to_id WHERE l.deleted=0 AND a.deleted=0 AND b.deleted=0`),
    ]).then(([rows, edges]) => { if (active) { setThoughts(rows); setLinks(edges); if (!centerId && edges.length) setCenterId(edges.sort((a,b) => b.created_at - a.created_at)[0].from_id); } });
    return () => { active = false; };
  }, [db, centerId]));
  const requested = typeof params.id === 'string' && params.id ? params.id : null;
  // Take a requested id once (state set during render, guarded by `taken`), then clear the param so it can't keep forcing Thought view.
  const [taken, setTaken] = useState(null);
  if (requested && requested !== taken) { setTaken(requested); setCenterId(requested); setView('thought'); }
  else if (!requested && taken) setTaken(null);
  useEffect(() => { if (requested) router.setParams({ id: '' }); }, [requested]);
  const chosen = centerId;
  const showThought = view === 'thought';
  const topics = useMemo(() => topicsFrom(thoughts), [thoughts]);
  const graph = useMemo(() => showThought ? neighbourhood(chosen, thoughts, links) : { nodes: topics, edges: topicEdges(topics, links) }, [showThought, chosen, thoughts, links, topics]);
  const placed = useMemo(() => layoutMap(graph.nodes, graph.edges, size.width, size.height, showThought), [graph, size, showThought]);
  const byId = new Map(placed.map((n) => [showThought ? n.id : n.tag, n]));
  const pan = Gesture.Pan().onStart(() => { startX.value = tx.value; startY.value = ty.value; }).onUpdate((e) => { tx.value = startX.value + e.translationX; ty.value = startY.value + e.translationY; });
  const pinch = Gesture.Pinch().onStart(() => { startZoom.value = zoom.value; }).onUpdate((e) => { zoom.value = Math.max(0.5, Math.min(2.5, startZoom.value * e.scale)); });
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }] }));
  // Reanimated shared values intentionally update in event handlers.
  // eslint-disable-next-line react-hooks/immutability
  const changeView = (next) => { router.setParams({ id: '' }); setView(next); tx.value = 0; ty.value = 0; zoom.value = 1; };
  // eslint-disable-next-line react-hooks/immutability
  const recenter = (id) => { router.setParams({ id: '' }); setCenterId(id); setView('thought'); tx.value = 0; ty.value = 0; zoom.value = 1; };
  const empty = !showThought && thoughts.filter((t) => t.status !== 'archived' && t.tags && t.tags !== '[]').length < 3;
  return <GestureHandlerRootView style={[styles.screen, { backgroundColor: c.bg }]}>
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerRow}><Text style={[type.screenTitle, { color: c.text }]}>Map</Text><View style={[styles.segment, { borderColor: c.ink, backgroundColor: c.surface }]} accessibilityRole="tablist">
        {['topics', 'thought'].map((item) => <Pressable key={item} onPress={() => changeView(item)} accessibilityRole="tab" accessibilityState={{ selected: showThought ? item === 'thought' : item === 'topics' }} style={[styles.segmentButton, (showThought ? item === 'thought' : item === 'topics') && { backgroundColor: c.ink }]}><Text style={{ color: (showThought ? item === 'thought' : item === 'topics') ? c.onInk : c.muted, fontFamily: font.figtree700, fontSize: 14 }}>{item === 'topics' ? 'Topics' : 'Thought'}</Text></Pressable>)}
      </View></View>
      <Text style={[type.meta, { color: c.muted }]}>{showThought ? 'Tap any thought to put it in the middle' : `${thoughts.length} thoughts in ${topics.length} topics · colour shows each topic's main type`}</Text>
    </View>
    <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}><View style={styles.canvas} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {empty ? <View style={styles.empty}><Svg width={96} height={76} viewBox="0 0 96 76"><Path d="M13 42 Q48 71 83 42 L76 66 Q48 80 20 66Z" fill={c.ideaTint} stroke={c.ink} strokeWidth={2.5}/><Path d="M31 36 Q18 15 35 12 M48 36 Q60 8 47 5 M65 36 Q80 19 66 12" fill="none" stroke={c.ink} strokeWidth={2.5} strokeLinecap="round"/><Circle cx={35} cy={12} r={5} fill={c.idea}/><Circle cx={47} cy={5} r={5} fill={c.project}/><Circle cx={66} cy={12} r={5} fill={c.memory}/></Svg><Text style={[type.emptyTitle, { color: c.text, textAlign: 'center' }]}>Your map is still cooking</Text><Text style={[type.meta, { color: c.muted, textAlign: 'center' }]}>Save a few tagged thoughts to see your topics.</Text></View> : showThought && graph.nodes.length === 0 ? <View style={styles.empty}><Text style={[type.emptyTitle, { color: c.text }]}>No linked thoughts yet</Text></View> : <Animated.View style={[styles.mapLayer, transform]}>
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">{graph.edges.map((edge, i) => { const a = byId.get(edge.source), b = byId.get(edge.target); return a && b ? <Path key={i} d={noodlePath(a,b)} fill="none" stroke={showThought && edge.hop === 1 ? c.ink : c.line} strokeWidth={showThought ? 2.5 : 3} strokeDasharray={edge.hop === 2 ? '1 7' : undefined} strokeLinecap="round"/> : null; })}</Svg>
        {placed.map((node) => { const kind = node.type || 'idea', major = showThought ? node.hop === 0 : node.tag === topics[0]?.tag, width = showThought ? (major ? 190 : node.hop === 1 ? 154 : 140) : node.radius * 2, height = showThought ? (major ? 76 : node.hop === 1 ? 64 : 48) : width; return <Pressable key={showThought ? node.id : node.tag} onPress={() => showThought ? recenter(node.id) : router.push({ pathname: '/search', params: { tag: node.tag } })} onLongPress={showThought ? () => router.push(`/thought/${node.id}`) : undefined} accessibilityRole="button" accessibilityLabel={showThought ? `${node.hop === 0 ? 'Centre' : node.hop === 1 ? relationLabel(graph.edges.find((edge) => edge.target === node.id)?.relation) : 'Related'}: ${node.title || node.text}` : `${node.name}, ${node.count} thoughts, mostly ${labels[kind]}`} style={[styles.node, { left: node.x - width/2, top: node.y - height/2, width, height, borderRadius: showThought ? (major ? 20 : 15) : width/2, backgroundColor: major ? c[kind] : node.hop === 2 ? c.bg : c[`${kind}Tint`], borderColor: major ? c.ink : c[kind], borderWidth: 2.5, borderStyle: node.hop === 2 ? 'dashed' : 'solid' }, major && { boxShadow: `0 4px 0 ${c.stickerShadow}` }]}>
          {showThought ? <><Text numberOfLines={1} style={{ fontFamily: font.figtree700, fontSize: 11, color: major ? c.labelInk : c[`${kind}Text`] }}>{node.hop === 2 ? '' : kind === 'todo' ? 'To-do' : kind[0].toUpperCase() + kind.slice(1)}</Text><Text numberOfLines={2} style={{ color: major ? c.labelInk : c.text, fontFamily: major ? font.bricolage800 : font.figtree700, fontSize: major ? 17 : 13 }}>{node.title || node.text}</Text></> : <><Text numberOfLines={2} style={{ textAlign: 'center', color: major ? c.labelInk : c[`${kind}Text`], fontFamily: font.bricolage700, fontSize: width < 75 ? 12 : width < 100 ? 15 : 17 }}>{node.name}</Text><Text style={{ color: major ? c.labelInk : c[`${kind}Text`], fontFamily: font.figtree700, fontSize: 12 }}>{node.count}</Text></>}
        </Pressable>; })}
        {showThought && graph.edges.filter((e) => e.hop === 1).map((edge, i) => { const a = byId.get(edge.source), b = byId.get(edge.target); return a && b ? <View key={i} pointerEvents="none" style={[styles.relation, { left: (a.x+b.x)/2-45, top: (a.y+b.y)/2-12, backgroundColor: c.ink }]}><Text style={{ color: c.onInk, fontFamily: font.figtree700, fontSize: 11 }}>{relationLabel(edge.relation)}</Text></View> : null; })}
        {showThought && graph.nodes.length === 1 && <Text style={[styles.noLinks, { color: c.muted, top: size.height/2 + 80 }]}>No linked thoughts yet</Text>}
      </Animated.View>}
    </View></GestureDetector>
  </GestureHandlerRootView>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, header: { paddingHorizontal: 20, gap: 4 }, headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, segment: { flexDirection: 'row', padding: 3, borderWidth: 2, borderRadius: 15 }, segmentButton: { minHeight: 38, minWidth: 74, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, borderRadius: 11 }, canvas: { flex: 1, overflow: 'hidden' }, mapLayer: { width: '100%', height: '100%' }, node: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, minWidth: 44, minHeight: 44 }, relation: { position: 'absolute', width: 90, alignItems: 'center', paddingVertical: 3, borderRadius: 10 }, noLinks: { position: 'absolute', alignSelf: 'center', fontFamily: font.figtree500 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 45 } });
