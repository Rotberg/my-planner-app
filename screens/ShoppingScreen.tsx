import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { loadData, saveData } from '../utils/storage';
import { supabase } from '../utils/supabase';
import { useTheme } from '../utils/theme';

const STORAGE_KEY = 'shopping';

const CATEGORIES = [
  'Fresh Food',
  'Frozen Food',
  'Bakery',
  'Drinks',
  'Household',
  'Other',
] as const;
type Category = (typeof CATEGORIES)[number];
const DEFAULT_CATEGORY: Category = 'Other';

function normalizeCategory(value: string | null | undefined): Category {
  return (CATEGORIES as readonly string[]).includes(value ?? '')
    ? (value as Category)
    : DEFAULT_CATEGORY;
}

const ShoppingItemFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Please enter an item name.')
    .max(80, 'Name is too long (max 80 characters).'),
  quantity: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+(\.\d+)?$/.test(v), {
      message: 'Quantity must be a number (e.g. 1, 2, 1.5).',
    })
    .refine((v) => v === '' || Number(v) > 0, {
      message: 'Quantity must be greater than zero.',
    }),
  category: z.enum(CATEGORIES),
});

const CatalogNameSchema = z
  .string()
  .trim()
  .min(1, 'Please enter a name.')
  .max(80, 'Name is too long (max 80 characters).');

type ShoppingItem = {
  id: string;
  name: string;
  quantity: string;
  checked: boolean;
  favorited: boolean;
  category: Category;
};

type SavedList = {
  id: string;
  name: string;
  created_at: string;
  delivery_date: string | null;
  items?: SavedListItem[];
};

type SavedListItem = {
  id: string;
  name: string;
  quantity: string | null;
  checked: boolean;
  category?: string | null;
};

type CatalogItem = { id: string; name: string };
type FavoriteItem = { id: string; name: string };

function formatShortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ShoppingScreen() {
  const theme = useTheme();
  const [view, setView] = useState<'current' | 'history'>('current');

  // Current list state (AsyncStorage)
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('');
  const [itemCategory, setItemCategory] = useState<Category>(DEFAULT_CATEGORY);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [deliveryDate, setDeliveryDate] = useState<Date | null>(null);
  const [showDeliveryPicker, setShowDeliveryPicker] = useState(false);

  // DB state
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  // UI toggles
  const [showCatalog, setShowCatalog] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState('');

  // Edit-item modal
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editCategory, setEditCategory] = useState<Category>(DEFAULT_CATEGORY);

  // ─── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadData(STORAGE_KEY).then((stored) => {
      if (stored) {
        setItems(
          stored.map((i: ShoppingItem) => ({ ...i, category: normalizeCategory(i.category) }))
        );
      }
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
      .select('id, name, created_at, delivery_date')
      .order('created_at', { ascending: false });
    if (data) setSavedLists(data);
  }

  async function fetchListItems(listId: string) {
    const { data } = await supabase
      .from('shopping_list_items')
      .select('id, name, quantity, checked, category')
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
    const parsed = ShoppingItemFormSchema.safeParse({
      name: itemName,
      quantity: itemQty,
      category: itemCategory,
    });
    if (!parsed.success) {
      Alert.alert('Invalid item', parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    const newItem: ShoppingItem = {
      id: Date.now().toString(),
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      checked: false,
      favorited: false,
      category: parsed.data.category,
    };
    persist([...items, newItem]);
    setItemName('');
    setItemQty('');
    setItemCategory(DEFAULT_CATEGORY);
  }

  function addFromCatalog(name: string) {
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    persist([
      ...items,
      {
        id: `${Date.now()}-${Math.random()}`,
        name,
        quantity: '',
        checked: false,
        favorited: false,
        category: DEFAULT_CATEGORY,
      },
    ]);
  }

  function addFromFavorites(name: string) {
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    persist([
      ...items,
      {
        id: `${Date.now()}-${Math.random()}`,
        name,
        quantity: '',
        checked: false,
        favorited: true,
        category: DEFAULT_CATEGORY,
      },
    ]);
  }

  // ─── Import from .csv / .txt ────────────────────────────────────────────────
  async function importFromFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/csv', 'text/comma-separated-values', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const uri = result.assets[0].uri;
      const response = await fetch(uri);
      const text = await response.text();

      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const newItems: ShoppingItem[] = [];
      let skipped = 0;

      for (const line of lines) {
        const parts = line.split(',').map((p) => p.trim());
        const name = parts[0];
        if (!name) continue;
        const qty = parts[1] ?? '';

        if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
          skipped++;
          continue;
        }
        newItems.push({
          id: `${Date.now()}-${Math.random()}`,
          name,
          quantity: qty,
          checked: false,
          favorited: false,
          category: DEFAULT_CATEGORY,
        });
      }

      if (newItems.length > 0) persist([...items, ...newItems]);

      Alert.alert(
        'Import complete',
        `Added ${newItems.length} item${newItems.length !== 1 ? 's' : ''}${
          skipped > 0 ? `, skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}` : ''
        }.`
      );
    } catch {
      Alert.alert('Import failed', 'Could not read the file. Make sure it is a .txt or .csv file.');
    }
  }

  function toggleChecked(id: string) {
    persist(items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)));
  }

  async function toggleFavorite(item: ShoppingItem) {
    const nowFavorited = !item.favorited;
    persist(items.map((i) => (i.id === item.id ? { ...i, favorited: nowFavorited } : i)));
    if (nowFavorited) {
      await supabase.from('favorite_items').upsert({ name: item.name }, { onConflict: 'name' });
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

  function openEditItem(item: ShoppingItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditQty(item.quantity);
    setEditCategory(item.category);
  }

  function saveEditItem() {
    if (!editingId) return;
    const parsed = ShoppingItemFormSchema.safeParse({
      name: editName,
      quantity: editQty,
      category: editCategory,
    });
    if (!parsed.success) {
      Alert.alert('Invalid item', parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    persist(
      items.map((i) =>
        i.id === editingId
          ? {
              ...i,
              name: parsed.data.name,
              quantity: parsed.data.quantity,
              category: parsed.data.category,
            }
          : i
      )
    );
    setEditingId(null);
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
    const name = new Date().toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const { data: list, error } = await supabase
      .from('shopping_lists')
      .insert({
        name,
        delivery_date: deliveryDate ? deliveryDate.toISOString().split('T')[0] : null,
      })
      .select()
      .single();

    if (error || !list) {
      console.error('[shopping] save list failed', error);
      Alert.alert(
        'Could not save list',
        error
          ? `${error.message}${error.code ? ` (code ${error.code})` : ''}${error.hint ? `\n\nHint: ${error.hint}` : ''}`
          : 'No data returned from server.',
      );
      return;
    }

    const { error: itemsError } = await supabase.from('shopping_list_items').insert(
      items.map((i) => ({
        list_id: list.id,
        name: i.name,
        quantity: i.quantity || null,
        checked: i.checked,
        category: i.category,
      }))
    );

    if (itemsError) {
      console.error('[shopping] save items failed', itemsError);
      Alert.alert(
        'List saved, but items failed',
        `${itemsError.message}${itemsError.code ? ` (code ${itemsError.code})` : ''}${itemsError.hint ? `\n\nHint: ${itemsError.hint}` : ''}`,
      );
      return;
    }

    setDeliveryDate(null);
    Alert.alert('Saved!', `"${name}" has been saved.`);
  }

  // ─── Catalog management ─────────────────────────────────────────────────────
  async function addToCatalog() {
    const parsed = CatalogNameSchema.safeParse(newCatalogName);
    if (!parsed.success) {
      Alert.alert('Invalid name', parsed.error.issues[0]?.message ?? 'Please check the name.');
      return;
    }
    await supabase
      .from('catalog_items')
      .upsert({ name: parsed.data }, { onConflict: 'name' });
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
              category: normalizeCategory(i.category),
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
      <View className="flex-row mx-4 mt-4 mb-3 bg-stone-200 dark:bg-stone-700 rounded-xl p-1">
        <Pressable
          className={`flex-1 py-2 rounded-lg items-center ${view === 'current' ? 'bg-white dark:bg-stone-800 shadow-sm' : ''}`}
          onPress={() => setView('current')}
        >
          <Text className={`text-sm font-semibold ${view === 'current' ? 'text-teal-700' : 'text-stone-500 dark:text-stone-400'}`}>
            Current List
          </Text>
        </Pressable>
        <Pressable
          className={`flex-1 py-2 rounded-lg items-center ${view === 'history' ? 'bg-white dark:bg-stone-800 shadow-sm' : ''}`}
          onPress={() => setView('history')}
        >
          <Text className={`text-sm font-semibold ${view === 'history' ? 'text-teal-700' : 'text-stone-500 dark:text-stone-400'}`}>
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
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
        <TabBar />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {savedLists.length === 0 ? (
            <Text className="text-center text-stone-400 dark:text-stone-500 mt-8 text-sm">
              No saved lists yet. Save your current list to see it here.
            </Text>
          ) : (
            savedLists.map((list) => {
              const isExpanded = expandedListId === list.id;
              return (
                <View key={list.id} className="bg-white dark:bg-stone-800 rounded-xl mb-3 shadow-sm overflow-hidden">
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
                      <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
                        {formatShortDate(list.created_at.split('T')[0])}
                      </Text>
                      {list.delivery_date && (
                        <Text className="text-xs text-teal-700 mt-0.5">
                          Delivery: {formatShortDate(list.delivery_date)}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity className="p-1.5 mr-2" onPress={() => confirmDeleteSavedList(list.id)}>
                      <Text className="text-stone-400 dark:text-stone-500 text-[15px]">🗑</Text>
                    </TouchableOpacity>
                    <Text className="text-stone-400 dark:text-stone-500 text-xs">{isExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View className="border-t border-stone-100 dark:border-stone-700 px-4 pb-4">
                      {list.items === undefined ? (
                        <Text className="text-stone-400 dark:text-stone-500 text-sm py-3">Loading…</Text>
                      ) : list.items.length === 0 ? (
                        <Text className="text-stone-400 dark:text-stone-500 text-sm py-3">No items in this list.</Text>
                      ) : (
                        list.items.map((item) => (
                          <View key={item.id} className="flex-row items-center py-2 border-b border-stone-100 dark:border-stone-700">
                            <Text
                              className={`flex-1 text-sm ${
                                item.checked ? 'line-through text-stone-400 dark:text-stone-500' : 'text-stone-700 dark:text-stone-200'
                              }`}
                            >
                              {item.name}
                              {item.quantity ? ` — ${item.quantity}` : ''}
                            </Text>
                            {item.checked && <Text className="text-xs text-teal-600 font-bold">✓</Text>}
                          </View>
                        ))
                      )}
                      {list.items && list.items.length > 0 && (
                        <TouchableOpacity
                          className="mt-3 bg-teal-50 border border-teal-200 rounded-lg py-2.5 items-center"
                          onPress={() => loadListToCurrent(list)}
                        >
                          <Text className="text-sm font-semibold text-teal-700">Load to Current List</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Current list view ──────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <TabBar />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Add Item card ── */}
        <View className="mx-4 mb-3 p-4 bg-white dark:bg-stone-800 rounded-xl shadow">
          <Text className="text-lg font-bold text-stone-800 dark:text-stone-100 mb-3">Add Item</Text>

          {/* Catalog quick-add */}
          <TouchableOpacity
            className="flex-row items-center mb-2"
            onPress={() => setShowCatalog(!showCatalog)}
          >
            <Text className="text-sm font-semibold text-stone-600 dark:text-stone-300 mr-1">From Catalog</Text>
            <Text className="text-xs text-stone-400 dark:text-stone-500">{showCatalog ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showCatalog && (
            <View className="mb-3">
              <View className="flex-row flex-wrap mb-2" style={{ gap: 6 }}>
                {catalogItems.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    className="bg-stone-100 dark:bg-stone-800 rounded-full px-3 py-1.5 border border-stone-200 dark:border-stone-700"
                    onPress={() => addFromCatalog(c.name)}
                    onLongPress={() => confirmDeleteCatalog(c)}
                  >
                    <Text className="text-xs text-stone-600 dark:text-stone-300 font-medium">+ {c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-stone-100"
                  placeholder="Add item to catalog…"
                  placeholderTextColor={theme.placeholder}
                  value={newCatalogName}
                  onChangeText={setNewCatalogName}
                  returnKeyType="done"
                  onSubmitEditing={addToCatalog}
                />
                <TouchableOpacity
                  className="bg-teal-600 rounded-lg px-3 py-2 items-center justify-center"
                  onPress={addToCatalog}
                >
                  <Text className="text-white text-sm font-bold">Add</Text>
                </TouchableOpacity>
              </View>
              <Text className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">Long-press a chip to remove it</Text>
            </View>
          )}

          {/* Favorites quick-add */}
          {favoriteItems.length > 0 && (
            <>
              <TouchableOpacity
                className="flex-row items-center mb-2"
                onPress={() => setShowFavorites(!showFavorites)}
              >
                <Text className="text-sm font-semibold text-amber-700 mr-1">★ Favorites</Text>
                <Text className="text-xs text-stone-400 dark:text-stone-500">{showFavorites ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {showFavorites && (
                <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                  {favoriteItems.map((f) => (
                    <TouchableOpacity
                      key={f.id}
                      className="bg-amber-50 rounded-full px-3 py-1.5 border border-amber-200"
                      onPress={() => addFromFavorites(f.name)}
                    >
                      <Text className="text-xs text-amber-800 font-medium">★ {f.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          {/* Item name with autocomplete */}
          {(() => {
            const nameLower = itemName.toLowerCase().trim();
            const suggestions: Array<{ name: string; isFavorite: boolean }> =
              nameLower.length === 0
                ? []
                : [
                    ...catalogItems
                      .filter(
                        (c) =>
                          c.name.toLowerCase().includes(nameLower) &&
                          c.name.toLowerCase() !== nameLower
                      )
                      .map((c) => ({ name: c.name, isFavorite: false })),
                    ...favoriteItems
                      .filter(
                        (f) =>
                          f.name.toLowerCase().includes(nameLower) &&
                          f.name.toLowerCase() !== nameLower &&
                          !catalogItems.some(
                            (c) => c.name.toLowerCase() === f.name.toLowerCase()
                          )
                      )
                      .map((f) => ({ name: f.name, isFavorite: true })),
                  ];
            return (
              <View className="mb-3">
                <TextInput
                  className={`border border-stone-200 dark:border-stone-700 px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 ${
                    suggestions.length > 0 ? 'rounded-t-lg' : 'rounded-lg'
                  }`}
                  placeholder="Item name…"
                  placeholderTextColor={theme.placeholder}
                  value={itemName}
                  onChangeText={setItemName}
                  returnKeyType="next"
                />
                {suggestions.length > 0 && (
                  <View className="border border-t-0 border-stone-200 dark:border-stone-700 rounded-b-lg overflow-hidden bg-white dark:bg-stone-800">
                    {suggestions.slice(0, 6).map((s, index) => (
                      <TouchableOpacity
                        key={s.name}
                        className={`flex-row items-center px-3 py-2.5 ${
                          index > 0 ? 'border-t border-stone-100 dark:border-stone-700' : ''
                        }`}
                        onPress={() => setItemName(s.name)}
                      >
                        {s.isFavorite && <Text className="text-amber-500 mr-2 text-sm">★</Text>}
                        <Text className="text-[14px] text-stone-700 dark:text-stone-200 flex-1">{s.name}</Text>
                        <Text className="text-[11px] text-stone-400 dark:text-stone-500">
                          {s.isFavorite ? 'favourite' : 'catalog'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })()}

          <TextInput
            className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
            placeholder="Quantity (optional, numeric e.g. 2 or 1.5)…"
            placeholderTextColor={theme.placeholder}
            value={itemQty}
            onChangeText={setItemQty}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={addItem}
          />

          <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5">Category</Text>
          <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
            {CATEGORIES.map((cat) => {
              const selected = itemCategory === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  className="rounded-full px-3 py-1 border"
                  style={
                    selected
                      ? { backgroundColor: '#0d9488', borderColor: '#0d9488' }
                      : { borderColor: '#e7e5e4' }
                  }
                  onPress={() => setItemCategory(cat)}
                >
                  <Text
                    className={`text-xs font-semibold ${selected ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            className="bg-teal-600 rounded-lg py-3 items-center mb-2"
            onPress={addItem}
          >
            <Text className="text-white text-[15px] font-bold">Add to List</Text>
          </TouchableOpacity>

          {/* Import from file */}
          <TouchableOpacity
            className="border border-stone-200 dark:border-stone-700 rounded-lg py-2.5 items-center"
            onPress={importFromFile}
          >
            <Text className="text-sm font-semibold text-stone-500 dark:text-stone-400">Import .csv / .txt</Text>
          </TouchableOpacity>
        </View>

        {/* ── Save current list ── */}
        {items.length > 0 && (
          <View className="mx-4 mb-3 p-4 bg-white dark:bg-stone-800 rounded-xl shadow">
            <Text className="text-sm font-bold text-stone-700 dark:text-stone-200 mb-2">Save List</Text>
            <Text className="text-xs text-stone-400 dark:text-stone-500 mb-2">
              Saved as today&apos;s date.
            </Text>

            {/* Delivery date */}
            <TouchableOpacity
              className="flex-row items-center justify-between border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 mb-2"
              onPress={() => setShowDeliveryPicker(true)}
            >
              <Text className="text-sm text-stone-600 dark:text-stone-300">
                {deliveryDate
                  ? `Delivery: ${deliveryDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : 'Add delivery date (optional)'}
              </Text>
              {deliveryDate && (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    setDeliveryDate(null);
                  }}
                >
                  <Text className="text-xs text-rose-600 font-semibold">Clear</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            {showDeliveryPicker && (
              <DateTimePicker
                value={deliveryDate ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, date) => {
                  setShowDeliveryPicker(Platform.OS === 'ios');
                  if (date) setDeliveryDate(date);
                }}
              />
            )}

            <TouchableOpacity
              className="bg-teal-600 rounded-lg py-2.5 items-center"
              onPress={saveCurrentList}
            >
              <Text className="text-white text-sm font-bold">Save List</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── List header ── */}
        {items.length > 0 && (
          <View className="flex-row justify-between items-center px-4 mb-2">
            <Text className="text-[13px] text-stone-500 dark:text-stone-400">
              {items.length} item{items.length !== 1 ? 's' : ''}
              {checkedCount > 0 ? ` · ${checkedCount} ticked` : ''}
            </Text>
            {checkedCount > 0 && (
              <TouchableOpacity onPress={clearChecked}>
                <Text className="text-[13px] text-rose-700 font-semibold">Clear ticked</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Items, grouped by category ── */}
        {items.length === 0 ? (
          <Text className="text-center text-stone-400 dark:text-stone-500 mt-6 text-sm px-4">
            Your shopping list is empty. Add something above!
          </Text>
        ) : (
          <View className="px-4">
            {CATEGORIES.map((cat) => {
              const groupItems = items.filter((i) => i.category === cat);
              if (groupItems.length === 0) return null;
              const collapsed = !!collapsedCategories[cat];
              return (
                <View key={cat} className="mb-3">
                  <TouchableOpacity
                    className="flex-row items-center bg-stone-100 dark:bg-stone-800 rounded-lg px-3 py-2 mb-2"
                    onPress={() =>
                      setCollapsedCategories((prev) => ({ ...prev, [cat]: !collapsed }))
                    }
                  >
                    <Text className="text-stone-500 dark:text-stone-400 text-xs mr-1.5">{collapsed ? '›' : '⌄'}</Text>
                    <Text className="text-[13px] font-semibold text-stone-700 dark:text-stone-200 flex-1">{cat}</Text>
                    <Text className="text-[12px] text-stone-500 dark:text-stone-400">{groupItems.length}</Text>
                  </TouchableOpacity>

                  {!collapsed &&
                    groupItems.map((item) => (
                      <View
                        key={item.id}
                        className="flex-row items-center bg-white dark:bg-stone-800 rounded-[10px] p-3 mb-2 shadow-sm"
                      >
                        <Pressable
                          className="w-[22px] h-[22px] rounded-[6px] border-2 border-teal-600 mr-3 items-center justify-center"
                          onPress={() => toggleChecked(item.id)}
                        >
                          {item.checked && (
                            <View className="w-[11px] h-[11px] rounded-[3px] bg-teal-600" />
                          )}
                        </Pressable>

                        <TouchableOpacity className="flex-1" onPress={() => openEditItem(item)}>
                          <Text
                            className={`text-[15px] font-medium ${
                              item.checked ? 'line-through text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-100'
                            }`}
                          >
                            {item.name}
                          </Text>
                          {item.quantity ? (
                            <Text className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{item.quantity}</Text>
                          ) : null}
                        </TouchableOpacity>

                        <TouchableOpacity className="p-1 mr-1" onPress={() => toggleFavorite(item)}>
                          <Text
                            className="text-xl"
                            style={{ color: item.favorited ? '#c2891c' : '#d6d3d1' }}
                          >
                            ★
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity className="p-1" onPress={() => confirmDeleteItem(item.id)}>
                          <Text className="text-sm text-stone-400 dark:text-stone-500">✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── Edit-item modal ── */}
      <Modal
        visible={editingId !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingId(null)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setEditingId(null)}
        >
          <Pressable className="bg-white dark:bg-stone-800 rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 dark:text-stone-100 mb-4">Edit Item</Text>

            <TextInput
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
              placeholder="Item name…"
              placeholderTextColor={theme.placeholder}
              value={editName}
              onChangeText={setEditName}
              autoFocus
            />

            <TextInput
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
              placeholder="Quantity (optional, numeric)…"
              placeholderTextColor={theme.placeholder}
              value={editQty}
              onChangeText={setEditQty}
              keyboardType="decimal-pad"
            />

            <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5">Category</Text>
            <View className="flex-row flex-wrap mb-4" style={{ gap: 6 }}>
              {CATEGORIES.map((cat) => {
                const selected = editCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    className="rounded-full px-3 py-1 border"
                    style={
                      selected
                        ? { backgroundColor: '#0d9488', borderColor: '#0d9488' }
                        : { borderColor: '#e7e5e4' }
                    }
                    onPress={() => setEditCategory(cat)}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        selected ? 'text-white' : 'text-stone-500 dark:text-stone-400'
                      }`}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View className="flex-row" style={{ gap: 12 }}>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-stone-200 dark:border-stone-700 rounded-lg py-3 items-center"
                onPress={() => setEditingId(null)}
              >
                <Text className="text-[15px] font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-teal-600 rounded-lg py-3 items-center"
                onPress={saveEditItem}
              >
                <Text className="text-[15px] font-bold text-white">Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
