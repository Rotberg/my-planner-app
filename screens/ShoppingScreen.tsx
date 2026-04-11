import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { loadData, saveData } from '../utils/storage';
import { supabase } from '../utils/supabase';

const STORAGE_KEY = 'shopping';

type ShoppingItem = {
  id: string;
  name: string;
  quantity: string;
  checked: boolean;
  favorited: boolean;
};

type SavedList = {
  id: string;
  name: string;
  created_at: string;
  items?: SavedListItem[];
};

type SavedListItem = {
  id: string;
  name: string;
  quantity: string | null;
  checked: boolean;
};

type CatalogItem = { id: string; name: string };
type FavoriteItem = { id: string; name: string };

export default function ShoppingScreen() {
  const [view, setView] = useState<'current' | 'history'>('current');

  // Current list state (AsyncStorage)
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('');
  const [listSaveName, setListSaveName] = useState('');

  // DB state
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  // UI toggles
  const [showCatalog, setShowCatalog] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState('');

  // ─── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadData(STORAGE_KEY).then((stored) => {
      if (stored) setItems(stored);
    });
    fetchCatalog();
    fetchFavorites();
  }, []);

  useEffect(() => {
    if (view === 'history') fetchSavedLists();
  }, [view]);

  // ─── Supabase fetches ───────────────────────────────────────────────────────
  async function fetchCatalog() {
    const { data } = await supabase.from('catalog_items').select('id, name').order('name');
    if (data) setCatalogItems(data);
  }

  async function fetchFavorites() {
    const { data } = await supabase.from('favorite_items').select('id, name').order('name');
    if (data) setFavoriteItems(data);
  }

  async function fetchSavedLists() {
    const { data } = await supabase
      .from('shopping_lists')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (data) setSavedLists(data);
  }

  async function fetchListItems(listId: string) {
    const { data } = await supabase
      .from('shopping_list_items')
      .select('id, name, quantity, checked')
      .eq('list_id', listId);
    if (data) {
      setSavedLists((prev) =>
        prev.map((l) => (l.id === listId ? { ...l, items: data } : l))
      );
    }
  }

  // ─── Current list helpers ───────────────────────────────────────────────────
  async function persist(updated: ShoppingItem[]) {
    setItems(updated);
    await saveData(STORAGE_KEY, updated);
  }

  function addItem() {
    if (!itemName.trim()) {
      Alert.alert('Missing name', 'Please enter an item name.');
      return;
    }
    const newItem: ShoppingItem = {
      id: Date.now().toString(),
      name: itemName.trim(),
      quantity: itemQty.trim(),
      checked: false,
      favorited: false,
    };
    persist([...items, newItem]);
    setItemName('');
    setItemQty('');
  }

  function addFromCatalog(name: string) {
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    persist([
      ...items,
      { id: `${Date.now()}-${Math.random()}`, name, quantity: '', checked: false, favorited: false },
    ]);
  }

  function addFromFavorites(name: string) {
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    persist([
      ...items,
      { id: `${Date.now()}-${Math.random()}`, name, quantity: '', checked: false, favorited: true },
    ]);
  }

  function toggleChecked(id: string) {
    persist(items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)));
  }

  async function toggleFavorite(item: ShoppingItem) {
    const nowFavorited = !item.favorited;
    persist(items.map((i) => (i.id === item.id ? { ...i, favorited: nowFavorited } : i)));

    if (nowFavorited) {
      await supabase
        .from('favorite_items')
        .upsert({ name: item.name }, { onConflict: 'name' });
    } else {
      await supabase.from('favorite_items').delete().eq('name', item.name);
    }
    fetchFavorites();
  }

  function confirmDeleteItem(id: string) {
    Alert.alert('Remove item', 'Remove this item from the list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => persist(items.filter((i) => i.id !== id)) },
    ]);
  }

  function clearChecked() {
    const unchecked = items.filter((i) => !i.checked);
    if (unchecked.length === items.length) return;
    Alert.alert('Clear ticked', 'Remove all ticked items?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => persist(unchecked) },
    ]);
  }

  // ─── Save list to DB ────────────────────────────────────────────────────────
  async function saveCurrentList() {
    if (items.length === 0) {
      Alert.alert('Empty list', 'Add some items before saving.');
      return;
    }
    const name = listSaveName.trim() || `List ${new Date().toLocaleDateString()}`;
    const { data: list, error } = await supabase
      .from('shopping_lists')
      .insert({ name })
      .select()
      .single();

    if (error || !list) {
      Alert.alert('Error', 'Could not save list. Check your connection.');
      return;
    }

    await supabase.from('shopping_list_items').insert(
      items.map((i) => ({
        list_id: list.id,
        name: i.name,
        quantity: i.quantity || null,
        checked: i.checked,
      }))
    );

    setListSaveName('');
    Alert.alert('Saved!', `"${name}" has been saved.`);
  }

  // ─── Catalog management ─────────────────────────────────────────────────────
  async function addToCatalog() {
    if (!newCatalogName.trim()) return;
    await supabase
      .from('catalog_items')
      .upsert({ name: newCatalogName.trim() }, { onConflict: 'name' });
    setNewCatalogName('');
    fetchCatalog();
  }

  function confirmDeleteCatalog(item: CatalogItem) {
    Alert.alert('Remove from catalog?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('catalog_items').delete().eq('id', item.id);
          fetchCatalog();
        },
      },
    ]);
  }

  // ─── Saved lists management ─────────────────────────────────────────────────
  function confirmDeleteSavedList(id: string) {
    Alert.alert('Delete list', 'Permanently delete this saved list?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('shopping_lists').delete().eq('id', id);
          setSavedLists((prev) => prev.filter((l) => l.id !== id));
        },
      },
    ]);
  }

  function loadListToCurrent(list: SavedList) {
    if (!list.items) return;
    Alert.alert('Load list', `Replace current list with "${list.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Load',
        onPress: () => {
          persist(
            list.items!.map((i) => ({
              id: `${Date.now()}-${Math.random()}`,
              name: i.name,
              quantity: i.quantity ?? '',
              checked: false,
              favorited: false,
            }))
          );
          setView('current');
        },
      },
    ]);
  }

  // ─── Shared tab bar ─────────────────────────────────────────────────────────
  function TabBar() {
    return (
      <View className="flex-row mx-4 mt-4 mb-3 bg-slate-200 rounded-xl p-1">
        <Pressable
          className={`flex-1 py-2 rounded-lg items-center ${view === 'current' ? 'bg-white shadow-sm' : ''}`}
          onPress={() => setView('current')}
        >
          <Text className={`text-sm font-semibold ${view === 'current' ? 'text-green-600' : 'text-slate-500'}`}>
            Current List
          </Text>
        </Pressable>
        <Pressable
          className={`flex-1 py-2 rounded-lg items-center ${view === 'history' ? 'bg-white shadow-sm' : ''}`}
          onPress={() => setView('history')}
        >
          <Text className={`text-sm font-semibold ${view === 'history' ? 'text-green-600' : 'text-slate-500'}`}>
            Saved Lists
          </Text>
        </Pressable>
      </View>
    );
  }

  const checkedCount = items.filter((i) => i.checked).length;

  // ─── History view ───────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <View className="flex-1 bg-slate-50">
        <TabBar />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {savedLists.length === 0 ? (
            <Text className="text-center text-slate-400 mt-8 text-sm">
              No saved lists yet. Save your current list to see it here.
            </Text>
          ) : (
            savedLists.map((list) => {
              const isExpanded = expandedListId === list.id;
              return (
                <View key={list.id} className="bg-white rounded-xl mb-3 shadow-sm overflow-hidden">
                  {/* List header row */}
                  <TouchableOpacity
                    className="flex-row items-center p-4"
                    onPress={() => {
                      if (isExpanded) {
                        setExpandedListId(null);
                      } else {
                        setExpandedListId(list.id);
                        if (!list.items) fetchListItems(list.id);
                      }
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-slate-800">{list.name}</Text>
                      <Text className="text-xs text-slate-400 mt-0.5">
                        {new Date(list.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <TouchableOpacity
                      className="p-1.5 mr-2"
                      onPress={() => confirmDeleteSavedList(list.id)}
                    >
                      <Text className="text-slate-400 text-[15px]">🗑</Text>
                    </TouchableOpacity>
                    <Text className="text-slate-400 text-xs">{isExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {/* Expanded items */}
                  {isExpanded && (
                    <View className="border-t border-slate-100 px-4 pb-4">
                      {list.items === undefined ? (
                        <Text className="text-slate-400 text-sm py-3">Loading…</Text>
                      ) : list.items.length === 0 ? (
                        <Text className="text-slate-400 text-sm py-3">No items in this list.</Text>
                      ) : (
                        list.items.map((item) => (
                          <View
                            key={item.id}
                            className="flex-row items-center py-2 border-b border-slate-50"
                          >
                            <Text
                              className={`flex-1 text-sm ${
                                item.checked ? 'line-through text-slate-400' : 'text-slate-700'
                              }`}
                            >
                              {item.name}
                              {item.quantity ? ` — ${item.quantity}` : ''}
                            </Text>
                            {item.checked && (
                              <Text className="text-xs text-green-500 font-bold">✓</Text>
                            )}
                          </View>
                        ))
                      )}

                      {list.items && list.items.length > 0 && (
                        <TouchableOpacity
                          className="mt-3 bg-green-50 border border-green-200 rounded-lg py-2.5 items-center"
                          onPress={() => loadListToCurrent(list)}
                        >
                          <Text className="text-sm font-semibold text-green-600">
                            Load to Current List
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  }

  // ─── Current list view ──────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-slate-50">
      <TabBar />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>

        {/* ── Add Item card ── */}
        <View className="mx-4 mb-3 p-4 bg-white rounded-xl shadow">
          <Text className="text-lg font-bold text-slate-800 mb-3">Add Item</Text>

          {/* Catalog quick-add */}
          <TouchableOpacity
            className="flex-row items-center mb-2"
            onPress={() => setShowCatalog(!showCatalog)}
          >
            <Text className="text-sm font-semibold text-slate-600 mr-1">From Catalog</Text>
            <Text className="text-xs text-slate-400">{showCatalog ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showCatalog && (
            <View className="mb-3">
              <View className="flex-row flex-wrap mb-2" style={{ gap: 6 }}>
                {catalogItems.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    className="bg-slate-100 rounded-full px-3 py-1.5 border border-slate-200"
                    onPress={() => addFromCatalog(c.name)}
                    onLongPress={() => confirmDeleteCatalog(c)}
                  >
                    <Text className="text-xs text-slate-600 font-medium">+ {c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800"
                  placeholder="Add item to catalog…"
                  placeholderTextColor="#94a3b8"
                  value={newCatalogName}
                  onChangeText={setNewCatalogName}
                  returnKeyType="done"
                  onSubmitEditing={addToCatalog}
                />
                <TouchableOpacity
                  className="bg-slate-500 rounded-lg px-3 py-2 items-center justify-center"
                  onPress={addToCatalog}
                >
                  <Text className="text-white text-sm font-bold">Add</Text>
                </TouchableOpacity>
              </View>
              <Text className="text-[11px] text-slate-400 mt-1">Long-press a chip to remove it</Text>
            </View>
          )}

          {/* Favorites quick-add */}
          {favoriteItems.length > 0 && (
            <>
              <TouchableOpacity
                className="flex-row items-center mb-2"
                onPress={() => setShowFavorites(!showFavorites)}
              >
                <Text className="text-sm font-semibold text-yellow-600 mr-1">★ Favorites</Text>
                <Text className="text-xs text-slate-400">{showFavorites ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {showFavorites && (
                <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                  {favoriteItems.map((f) => (
                    <TouchableOpacity
                      key={f.id}
                      className="bg-yellow-50 rounded-full px-3 py-1.5 border border-yellow-200"
                      onPress={() => addFromFavorites(f.name)}
                    >
                      <Text className="text-xs text-yellow-700 font-medium">★ {f.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          {/* Manual item input */}
          <TextInput
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-slate-800 mb-3"
            placeholder="Item name…"
            placeholderTextColor="#94a3b8"
            value={itemName}
            onChangeText={setItemName}
            returnKeyType="next"
          />
          <TextInput
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-slate-800 mb-3"
            placeholder="Quantity (optional, e.g. 2, 500g)…"
            placeholderTextColor="#94a3b8"
            value={itemQty}
            onChangeText={setItemQty}
            returnKeyType="done"
            onSubmitEditing={addItem}
          />
          <TouchableOpacity
            className="bg-green-500 rounded-lg py-3 items-center"
            onPress={addItem}
          >
            <Text className="text-white text-[15px] font-bold">Add to List</Text>
          </TouchableOpacity>
        </View>

        {/* ── Save current list ── */}
        {items.length > 0 && (
          <View className="mx-4 mb-3 p-4 bg-white rounded-xl shadow">
            <Text className="text-sm font-bold text-slate-700 mb-2">Save List to DB</Text>
            <View className="flex-row" style={{ gap: 8 }}>
              <TextInput
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800"
                placeholder="List name (e.g. Weekly Shop)…"
                placeholderTextColor="#94a3b8"
                value={listSaveName}
                onChangeText={setListSaveName}
              />
              <TouchableOpacity
                className="bg-indigo-500 rounded-lg px-4 py-2 items-center justify-center"
                onPress={saveCurrentList}
              >
                <Text className="text-white text-sm font-bold">Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── List header ── */}
        {items.length > 0 && (
          <View className="flex-row justify-between items-center px-4 mb-2">
            <Text className="text-[13px] text-slate-500">
              {items.length} item{items.length !== 1 ? 's' : ''}
              {checkedCount > 0 ? ` · ${checkedCount} ticked` : ''}
            </Text>
            {checkedCount > 0 && (
              <TouchableOpacity onPress={clearChecked}>
                <Text className="text-[13px] text-red-500 font-semibold">Clear ticked</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Items ── */}
        {items.length === 0 ? (
          <Text className="text-center text-slate-400 mt-6 text-sm px-4">
            Your shopping list is empty. Add something above!
          </Text>
        ) : (
          <View className="px-4">
            {items.map((item) => (
              <View
                key={item.id}
                className="flex-row items-center bg-white rounded-[10px] p-3 mb-2.5 shadow-sm"
              >
                <Pressable
                  className="w-[22px] h-[22px] rounded-[6px] border-2 border-green-500 mr-3 items-center justify-center"
                  onPress={() => toggleChecked(item.id)}
                >
                  {item.checked && (
                    <View className="w-[11px] h-[11px] rounded-[3px] bg-green-500" />
                  )}
                </Pressable>

                <View className="flex-1">
                  <Text
                    className={`text-[15px] font-medium ${
                      item.checked ? 'line-through text-slate-400' : 'text-slate-800'
                    }`}
                  >
                    {item.name}
                  </Text>
                  {item.quantity ? (
                    <Text className="text-xs text-slate-400 mt-0.5">{item.quantity}</Text>
                  ) : null}
                </View>

                {/* Favourite star */}
                <TouchableOpacity className="p-1 mr-1" onPress={() => toggleFavorite(item)}>
                  <Text
                    className="text-xl"
                    style={{ color: item.favorited ? '#facc15' : '#cbd5e1' }}
                  >
                    ★
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity className="p-1" onPress={() => confirmDeleteItem(item.id)}>
                  <Text className="text-sm text-slate-400">✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
