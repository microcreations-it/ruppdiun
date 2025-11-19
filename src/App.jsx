import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Check, Clock, LogOut, Eye, EyeOff, DollarSign } from 'lucide-react';
import { useDatabase } from './useDatabase';

export default function GestionaleRistorante() {
  const { menu: dbMenu, kitchenOrders: dbKitchenOrders, barOrders: dbBarOrders, archivedOrders: dbArchivedOrders, loading, error, saveData } = useDatabase();
  
  // Stati globali
  const [role, setRole] = useState(null);
  const [menu, setMenu] = useState([]);
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [barOrders, setBarOrders] = useState([]);
  const [archivedOrders, setArchivedOrders] = useState([]);
  const [hiddenDishes, setHiddenDishes] = useState([]);
  const [tables] = useState(Array.from({length: 12}, (_, i) => ({ id: i+1 })));
  const [notifications, setNotifications] = useState([]);
  const [notifiedOrders, setNotifiedOrders] = useState(new Set());
  
  // Stati per il Gestore
  const [selectedTableForPayment, setSelectedTableForPayment] = useState(null);
  const [newDish, setNewDish] = useState({ name: '', price: '', category: 'Coperti', notes: '', allergens: '' });
  const [showArchive, setShowArchive] = useState(false);
  
  // Stati per il Cameriere
  const [selectedTable, setSelectedTable] = useState(null);
  const [currentOrderItems, setCurrentOrderItems] = useState([]);
  const [showMenu, setShowMenu] = useState(false);

  // Categorie menu
  const MENU_CATEGORIES = ['Coperti', 'Antipasti', 'Primi', 'Secondi', 'Contorni', 'Dessert', 'Bibite', 'Birre', 'Vini', 'Bar'];

  // Carica dati dal database
  useEffect(() => {
    setMenu(dbMenu);
  }, [dbMenu]);

  useEffect(() => {
    setKitchenOrders(dbKitchenOrders);
  }, [dbKitchenOrders]);

  useEffect(() => {
    setBarOrders(dbBarOrders);
  }, [dbBarOrders]);

  useEffect(() => {
    setArchivedOrders(dbArchivedOrders);
  }, [dbArchivedOrders]);

  // Sistema di notifiche per ordini pronti (solo per cameriere)
  useEffect(() => {
    if (role !== 'cameriere') return;
    
    const allOrders = [...kitchenOrders, ...barOrders];
    const readyOrders = allOrders.filter(order => order.status === 'pronto');
    
    readyOrders.forEach(order => {
      // Controlla se questo ordine è già stato notificato
      if (!notifiedOrders.has(order.id)) {
        const newNotif = {
          id: Date.now() + Math.random(),
          orderId: order.id,
          tableId: order.tableId,
          message: `Ordine Tavolo ${order.tableId} pronto!`,
          type: order.id.endsWith('-k') ? 'cucina' : 'bar'
        };
        setNotifications(prev => [...prev, newNotif]);
        setNotifiedOrders(prev => new Set([...prev, order.id]));
      }
    });
    
    // Rimuovi dal tracking gli ordini che non esistono più (pagati)
    const existingOrderIds = new Set(allOrders.map(o => o.id));
    setNotifiedOrders(prev => {
      const updated = new Set([...prev].filter(id => existingOrderIds.has(id)));
      return updated;
    });
    
    // Rimuovi notifiche per ordini che non esistono più
    setNotifications(prev => 
      prev.filter(notif => existingOrderIds.has(notif.orderId))
    );
  }, [kitchenOrders, barOrders, role]);

  // ========== FUNZIONI MENU ==========
  const addDish = async () => {
    if (newDish.name && newDish.price) {
      const newMenu = [...menu, { 
        id: Date.now().toString(), 
        name: newDish.name,
        price: parseFloat(newDish.price),
        category: newDish.category,
        notes: newDish.notes,
        allergens: newDish.allergens
      }];
      setMenu(newMenu);
      await saveData(newMenu, kitchenOrders, barOrders, archivedOrders);
      setNewDish({ name: '', price: '', category: 'Coperti', notes: '', allergens: '' });
    }
  };

  const removeDish = async (id) => {
    const newMenu = menu.filter(d => d.id !== id);
    setMenu(newMenu);
    await saveData(newMenu, kitchenOrders, barOrders, archivedOrders);
  };

  const toggleHideDish = (id) => {
    setHiddenDishes(prev => 
      prev.includes(id) ? prev.filter(hd => hd !== id) : [...prev, id]
    );
  };

  // ========== FUNZIONI ORDINI ==========
  const addToOrder = (dish) => {
    const existing = currentOrderItems.find(item => item.dishId === dish.id);
    if (existing) {
      setCurrentOrderItems(currentOrderItems.map(item =>
        item.dishId === dish.id ? { ...item, qty: item.qty + 1 } : item
      ));
    } else {
      setCurrentOrderItems([...currentOrderItems, { 
        dishId: dish.id, 
        name: dish.name, 
        price: dish.price, 
        qty: 1, 
        notes: '' 
      }]);
    }
  };

  const removeFromOrder = (index) => {
    setCurrentOrderItems(currentOrderItems.filter((_, i) => i !== index));
  };

  const updateQuantity = (index, newQty) => {
    if (newQty > 0) {
      setCurrentOrderItems(currentOrderItems.map((item, i) =>
        i === index ? { ...item, qty: newQty } : item
      ));
    }
  };

  const updateNotes = (index, notes) => {
    setCurrentOrderItems(currentOrderItems.map((item, i) =>
      i === index ? { ...item, notes } : item
    ));
  };

  const saveOrder = async () => {
    if (selectedTable && currentOrderItems.length > 0) {
      const timestamp = new Date().toLocaleTimeString('it-IT');
      const orderId = Date.now().toString();
      const total = currentOrderItems.reduce((sum, item) => sum + item.price * item.qty, 0);

      // Separa ordini cucina e bar (Bibite, Birre, Vini, Bar vanno al bar)
      const kitchenItems = currentOrderItems.filter(item => {
        const dish = menu.find(d => d.id === item.dishId);
        return dish && !['Bibite', 'Birre', 'Vini', 'Bar'].includes(dish.category);
      });
      
      const barItems = currentOrderItems.filter(item => {
        const dish = menu.find(d => d.id === item.dishId);
        return dish && ['Bibite', 'Birre', 'Vini', 'Bar'].includes(dish.category);
      });

      let newKitchenOrders = kitchenOrders;
      let newBarOrders = barOrders;

      // Cucina: stato "in_attesa" - richiede approvazione cameriere
      if (kitchenItems.length > 0) {
        newKitchenOrders = [...kitchenOrders, {
          id: orderId + '-k',
          tableId: selectedTable,
          items: kitchenItems,
          status: 'in_attesa',
          timestamp,
          total: kitchenItems.reduce((sum, item) => sum + item.price * item.qty, 0)
        }];
      }

      // Bar: stato "nuovo" - preparazione immediata
      if (barItems.length > 0) {
        newBarOrders = [...barOrders, {
          id: orderId + '-b',
          tableId: selectedTable,
          items: barItems,
          status: 'nuovo',
          timestamp,
          total: barItems.reduce((sum, item) => sum + item.price * item.qty, 0)
        }];
      }

      setKitchenOrders(newKitchenOrders);
      setBarOrders(newBarOrders);
      await saveData(menu, newKitchenOrders, newBarOrders, archivedOrders);
      
      // Resetta solo gli items, NON il tavolo selezionato
      setCurrentOrderItems([]);
      setShowMenu(false);
      // RIMOSSO: setSelectedTable(null); - così resta sulla gestione del tavolo
    }
  };

  const updateKitchenOrderStatus = async (orderId, newStatus) => {
    const newKitchenOrders = kitchenOrders.map(order =>
      order.id === orderId ? { ...order, status: newStatus } : order
    );
    setKitchenOrders(newKitchenOrders);
    await saveData(menu, newKitchenOrders, barOrders, archivedOrders);
  };

  const updateBarOrderStatus = async (orderId, newStatus) => {
    const newBarOrders = barOrders.map(order =>
      order.id === orderId ? { ...order, status: newStatus } : order
    );
    setBarOrders(newBarOrders);
    await saveData(menu, kitchenOrders, newBarOrders, archivedOrders);
  };

  const approveKitchenOrder = async (orderId) => {
    const newKitchenOrders = kitchenOrders.map(order =>
      order.id === orderId ? { ...order, status: 'nuovo' } : order
    );
    setKitchenOrders(newKitchenOrders);
    await saveData(menu, newKitchenOrders, barOrders, archivedOrders);
  };

  const cancelOrder = async (orderId) => {
    if (!confirm('Sei sicuro di voler annullare questo ordine?')) return;
    
    // Cerca se è ordine cucina o bar e marca come annullato
    if (orderId.endsWith('-k')) {
      const newKitchenOrders = kitchenOrders.map(order =>
        order.id === orderId ? { ...order, status: 'annullato' } : order
      );
      setKitchenOrders(newKitchenOrders);
      await saveData(menu, newKitchenOrders, barOrders, archivedOrders);
    } else {
      const newBarOrders = barOrders.map(order =>
        order.id === orderId ? { ...order, status: 'annullato' } : order
      );
      setBarOrders(newBarOrders);
      await saveData(menu, kitchenOrders, newBarOrders, archivedOrders);
    }
  };

  const goBackOrderStatus = async (orderId, isKitchen = true) => {
    if (isKitchen) {
      const newKitchenOrders = kitchenOrders.map(order => {
        if (order.id === orderId) {
          if (order.status === 'pronto') return { ...order, status: 'in_preparazione' };
          if (order.status === 'in_preparazione') return { ...order, status: 'nuovo' };
        }
        return order;
      });
      setKitchenOrders(newKitchenOrders);
      await saveData(menu, newKitchenOrders, barOrders, archivedOrders);
    } else {
      const newBarOrders = barOrders.map(order => {
        if (order.id === orderId) {
          if (order.status === 'pronto') return { ...order, status: 'in_preparazione' };
          if (order.status === 'in_preparazione') return { ...order, status: 'nuovo' };
        }
        return order;
      });
      setBarOrders(newBarOrders);
      await saveData(menu, kitchenOrders, newBarOrders, archivedOrders);
    }
  };

  const markAsPaid = async (tableId) => {
    const tableOrders = getTableAllOrders(tableId).filter(o => o.status !== 'annullato'); // Escludi annullati
    
    if (tableOrders.length === 0) {
      alert('Non ci sono ordini da pagare per questo tavolo.');
      return;
    }
    
    // Crea record archivio
    const archivedRecord = {
      id: Date.now().toString(),
      tableId: tableId,
      orders: tableOrders,
      total: calculateTableTotal(tableId),
      timestamp: new Date().toLocaleString('it-IT'),
      date: new Date().toISOString()
    };
    
    // Rimuovi ordini pagati e aggiungi all'archivio
    const newKitchenOrders = kitchenOrders.filter(o => o.tableId !== tableId);
    const newBarOrders = barOrders.filter(o => o.tableId !== tableId);
    const newArchivedOrders = [...archivedOrders, archivedRecord];
    
    setKitchenOrders(newKitchenOrders);
    setBarOrders(newBarOrders);
    setArchivedOrders(newArchivedOrders);
    await saveData(menu, newKitchenOrders, newBarOrders, newArchivedOrders);
  };

  // ========== UTILITY ==========
  const getTableAllOrders = (tableId) => {
    return [...kitchenOrders, ...barOrders].filter(o => o.tableId === tableId);
  };

  const calculateTableTotal = (tableId) => {
    return getTableAllOrders(tableId)
      .filter(order => order.status !== 'annullato') // Escludi ordini annullati
      .reduce((sum, order) => 
        sum + order.items.reduce((itemSum, item) => itemSum + (item.price * item.qty), 0), 0
      );
  };

  const closeNotification = (notifId) => {
    setNotifications(prev => prev.filter(n => n.id !== notifId));
  };

  const printTableBill = (tableId) => {
    const orders = getTableAllOrders(tableId);
    const total = calculateTableTotal(tableId);
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conto Tavolo ${tableId}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .header { text-align: center; margin-bottom: 20px; }
          .order { margin-bottom: 20px; border: 1px solid #ddd; padding: 10px; }
          .order-header { font-weight: bold; background: #f0f0f0; padding: 5px; margin-bottom: 10px; }
          .item { display: flex; justify-content: space-between; padding: 5px 0; }
          .total { margin-top: 20px; padding-top: 10px; border-top: 2px solid #000; font-size: 1.2em; font-weight: bold; text-align: right; }
          @media print {
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🍽️ Gestionale Ristorante</h1>
          <p>Tavolo ${tableId} - ${new Date().toLocaleString('it-IT')}</p>
        </div>
        ${orders.map(order => `
          <div class="order">
            <div class="order-header">
              Ordine ore ${order.timestamp} - ${order.id.endsWith('-k') ? '👨‍🍳 Cucina' : '🍹 Bar'}
            </div>
            ${order.items.map(item => `
              <div class="item">
                <span>${item.qty}x ${item.name}${item.notes ? ` (${item.notes})` : ''}</span>
                <span>€ ${(item.price * item.qty).toFixed(2)}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
        <div class="total">
          TOTALE: € ${total.toFixed(2)}
        </div>
        <div style="text-align: center; margin-top: 30px;">
          <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">
            🖨️ Stampa
          </button>
          <button onclick="window.close()" style="padding: 10px 20px; font-size: 16px; cursor: pointer; margin-left: 10px;">
            ❌ Chiudi
          </button>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const printArchivedOrder = (record) => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conto Archiviato - Tavolo ${record.tableId}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .header { text-align: center; margin-bottom: 20px; }
          .order { margin-bottom: 20px; border: 1px solid #ddd; padding: 10px; }
          .order-header { font-weight: bold; background: #f0f0f0; padding: 5px; margin-bottom: 10px; }
          .item { display: flex; justify-content: space-between; padding: 5px 0; }
          .total { margin-top: 20px; padding-top: 10px; border-top: 2px solid #000; font-size: 1.2em; font-weight: bold; text-align: right; }
          @media print {
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🍽️ Gestionale Ristorante</h1>
          <p>Tavolo ${record.tableId} - ${record.timestamp}</p>
          <p style="color: #666; font-size: 0.9em;">📦 Ordine Archiviato</p>
        </div>
        ${record.orders.map(order => `
          <div class="order">
            <div class="order-header">
              Ordine ore ${order.timestamp} - ${order.id.endsWith('-k') ? '👨‍🍳 Cucina' : '🍹 Bar'}
            </div>
            ${order.items.map(item => `
              <div class="item">
                <span>${item.qty}x ${item.name}${item.notes ? ` (${item.notes})` : ''}</span>
                <span>€ ${(item.price * item.qty).toFixed(2)}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
        <div class="total">
          TOTALE: € ${record.total.toFixed(2)}
        </div>
        <div style="text-align: center; margin-top: 30px;">
          <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">
            🖨️ Stampa
          </button>
          <button onclick="window.close()" style="padding: 10px 20px; font-size: 16px; cursor: pointer; margin-left: 10px;">
            ❌ Chiudi
          </button>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const logout = () => {
    setRole(null);
    setPassword('');
    setLoginError('');
    setSelectedTable(null);
    setCurrentOrderItems([]);
    setShowMenu(false);
    setSelectedTableForPayment(null);
  };

  const handleLogin = (selectedRole) => {
    const enteredPassword = prompt(`Inserisci la password per ${getRoleName(selectedRole)}:`);
    
    if (!enteredPassword) return;
    
    if (PASSWORDS[selectedRole] === enteredPassword) {
      setRole(selectedRole);
      setPassword('');
      setLoginError('');
    } else {
      setLoginError('Password errata!');
      setTimeout(() => setLoginError(''), 3000);
    }
  };

  const getRoleName = (role) => {
    const names = {
      admin: 'Amministratore',
      cucina: 'Cucina',
      bar: 'Bar',
      cameriere: 'Cameriere',
      cameriere_bar: 'Cameriere + Bar',
      menu: 'Gestione Menu'
    };
    return names[role] || role;
  };

  const clearArchive = async () => {
    if (!confirm('Sei sicuro di voler cancellare tutto l\'archivio? Questa azione è irreversibile!')) return;
    
    const secondConfirm = prompt('Scrivi "CANCELLA" per confermare:');
    if (secondConfirm !== 'CANCELLA') return;
    
    setArchivedOrders([]);
    await saveData(menu, kitchenOrders, barOrders, []);
    alert('Archivio cancellato con successo!');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-2xl text-gray-600">Caricamento...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
          <h2 className="text-2xl font-bold text-red-600 mb-4">❌ Errore di Connessione</h2>
          <p className="text-gray-700 mb-4">{error}</p>
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
            <p className="text-sm text-yellow-800">
              <strong>Possibili cause:</strong>
            </p>
            <ul className="text-sm text-yellow-700 mt-2 list-disc list-inside">
              <li>Chiave API JSONBin scaduta o non valida</li>
              <li>Limiti del piano gratuito raggiunti</li>
              <li>Bin non accessibile</li>
            </ul>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full bg-blue-500 text-white py-3 rounded-lg font-semibold hover:bg-blue-600 transition"
          >
            🔄 Riprova
          </button>
        </div>
      </div>
    );
  }

  // ========================================
  // GESTIONE MENU
  // ========================================
  if (role === 'menu' || role === 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-purple-100 p-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-purple-900">📝 Gestione Menu</h1>
            <button onClick={logout} className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
              <LogOut size={18} /> Esci
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Form Aggiungi Piatto */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-lg p-6 sticky top-4">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Aggiungi Piatto</h2>
                <div className="space-y-3">
                  <input 
                    type="text" 
                    placeholder="Nome piatto" 
                    value={newDish.name} 
                    onChange={(e) => setNewDish({...newDish, name: e.target.value})} 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" 
                  />
                  <input 
                    type="number" 
                    placeholder="Prezzo (€)" 
                    value={newDish.price} 
                    onChange={(e) => setNewDish({...newDish, price: e.target.value})} 
                    step="0.10" 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" 
                  />
                  <select 
                    value={newDish.category} 
                    onChange={(e) => setNewDish({...newDish, category: e.target.value})} 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  >
                    {MENU_CATEGORIES.map(cat => (
                      <option key={cat}>{cat}</option>
                    ))}
                  </select>
                  <input 
                    type="text" 
                    placeholder="Note (es. senza glutine)" 
                    value={newDish.notes} 
                    onChange={(e) => setNewDish({...newDish, notes: e.target.value})} 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" 
                  />
                  <input 
                    type="text" 
                    placeholder="Allergeni (es. arachidi)" 
                    value={newDish.allergens} 
                    onChange={(e) => setNewDish({...newDish, allergens: e.target.value})} 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" 
                  />
                  <button 
                    onClick={addDish} 
                    className="w-full bg-purple-500 text-white py-3 rounded-lg font-semibold hover:bg-purple-600 transition flex items-center justify-center gap-2"
                  >
                    <Plus size={20} /> Aggiungi
                  </button>
                </div>
              </div>
            </div>

            {/* Lista Menu */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Menu Completo ({menu.length} piatti)</h2>
                {menu.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">Nessun piatto nel menu</p>
                ) : (
                  <div className="space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
                    {MENU_CATEGORIES.map(cat => {
                      const items = menu.filter(d => d.category === cat);
                      if (items.length === 0) return null;
                      return (
                        <div key={cat}>
                          <h3 className="font-bold text-gray-800 text-lg mb-3 border-b-2 border-purple-200 pb-2">{cat}</h3>
                          <div className="grid gap-3">
                            {items.map(dish => (
                              <div key={dish.id} className={`p-3 rounded-lg border-2 ${hiddenDishes.includes(dish.id) ? 'bg-gray-100 border-gray-300 opacity-60' : 'bg-white border-gray-200'}`}>
                                <div className="flex justify-between items-start gap-3">
                                  <div className="flex-1">
                                    <p className={`font-semibold text-base ${hiddenDishes.includes(dish.id) ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                                      {dish.name}
                                    </p>
                                    <p className="text-green-600 font-bold text-base mt-1">€ {dish.price.toFixed(2)}</p>
                                    {dish.notes && <p className="text-xs text-blue-600 mt-1">ℹ️ {dish.notes}</p>}
                                    {dish.allergens && <p className="text-xs text-red-600 mt-1">⚠️ {dish.allergens}</p>}
                                  </div>
                                  <div className="flex gap-2">
                                    <button 
                                      onClick={() => toggleHideDish(dish.id)} 
                                      className={`px-3 py-2 text-sm rounded font-bold transition ${hiddenDishes.includes(dish.id) ? 'bg-yellow-500 text-white hover:bg-yellow-600' : 'bg-gray-400 text-white hover:bg-gray-500'}`}
                                      title={hiddenDishes.includes(dish.id) ? 'Rendi visibile' : 'Nascondi'}
                                    >
                                      {hiddenDishes.includes(dish.id) ? '👁️' : '🚫'}
                                    </button>
                                    <button 
                                      onClick={() => removeDish(dish.id)} 
                                      className="px-3 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600 transition"
                                      title="Elimina piatto"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // GESTORE (SENZA MENU)
  // ========================================
  if (role === 'gestore' || role === 'admin') {
    const tableOrders = selectedTableForPayment ? getTableAllOrders(selectedTableForPayment) : [];
    const totalAmount = selectedTableForPayment ? calculateTableTotal(selectedTableForPayment) : 0;

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-blue-900">📋 Gestore - Cassa</h1>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowArchive(!showArchive)} 
                className="flex items-center gap-2 bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 transition"
              >
                📦 {showArchive ? 'Nascondi' : 'Archivio'}
              </button>
              <button onClick={logout} className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
                <LogOut size={18} /> Esci
              </button>
            </div>
          </div>

          {/* Archivio Ordini Pagati */}
          {showArchive && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800">📦 Archivio Ordini Pagati</h2>
                {archivedOrders.length > 0 && (
                  <button
                    onClick={clearArchive}
                    className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition text-sm font-semibold"
                  >
                    🗑️ Cancella Archivio
                  </button>
                )}
              </div>
              {archivedOrders.length === 0 ? (
                <p className="text-gray-500 text-center py-4">Nessun ordine nell'archivio</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {archivedOrders.slice().reverse().map(record => (
                    <div key={record.id} className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-gray-800">Tavolo {record.tableId}</p>
                          <p className="text-sm text-gray-600">{record.timestamp}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xl font-bold text-green-600">€ {record.total.toFixed(2)}</span>
                          <button
                            onClick={() => printArchivedOrder(record)}
                            className="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600 transition"
                          >
                            🖨️ Stampa
                          </button>
                        </div>
                      </div>
                      <div className="text-sm text-gray-700">
                        {record.orders.map((order, idx) => (
                          <div key={idx} className="mt-2">
                            <p className="font-semibold">{order.id.endsWith('-k') ? '👨‍🍳 Cucina' : '🍹 Bar'} - {order.timestamp}</p>
                            {order.items.map((item, i) => (
                              <p key={i} className="ml-4">{item.qty}x {item.name} - € {(item.price * item.qty).toFixed(2)}</p>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6">
            {/* Sezione Tavoli e Pagamenti */}
            <div>
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Tavoli - Gestione Pagamenti</h2>
                
                {/* Griglia Tavoli */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {tables.map(table => {
                    const hasOrders = getTableAllOrders(table.id).length > 0;
                    return (
                      <button
                        key={table.id}
                        onClick={() => setSelectedTableForPayment(selectedTableForPayment === table.id ? null : table.id)}
                        className={`p-4 rounded-lg font-bold transition ${
                          selectedTableForPayment === table.id
                            ? 'bg-blue-500 text-white ring-2 ring-blue-700'
                            : hasOrders
                            ? 'bg-red-100 text-red-800 hover:bg-red-200'
                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                        }`}
                      >
                        T{table.id}
                        {hasOrders && <div className="text-xs mt-1">({getTableAllOrders(table.id).length})</div>}
                      </button>
                    );
                  })}
                </div>

                {/* Dettagli Ordini Tavolo */}
                {selectedTableForPayment && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-800">Ordini Tavolo {selectedTableForPayment}</h3>
                    
                    {tableOrders.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">Nessun ordine in sospeso</p>
                    ) : (
                      <>
                        {tableOrders.map(order => (
                          <div 
                            key={order.id} 
                            className={`border-l-4 p-4 rounded-lg ${
                              order.status === 'annullato' ? 'bg-gray-200 border-gray-600' :
                              order.status === 'in_attesa' ? 'bg-gray-50 border-gray-400' :
                              order.status === 'nuovo' ? 'bg-red-50 border-red-500' :
                              order.status === 'in_preparazione' ? 'bg-yellow-50 border-yellow-500' :
                              'bg-green-50 border-green-500'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-sm text-gray-600">{order.timestamp}</span>
                              <span className={`text-xs px-2 py-1 rounded ${
                                order.status === 'annullato' ? 'bg-gray-400 text-white' :
                                order.status === 'in_attesa' ? 'bg-gray-200 text-gray-800' :
                                order.status === 'nuovo' ? 'bg-red-200 text-red-800' :
                                order.status === 'in_preparazione' ? 'bg-yellow-200 text-yellow-800' :
                                'bg-green-200 text-green-800'
                              }`}>
                                {order.status === 'annullato' ? 'Annullato' :
                                 order.status === 'in_attesa' ? 'In Attesa' :
                                 order.status === 'nuovo' ? 'Nuovo' : 
                                 order.status === 'in_preparazione' ? 'In Preparazione' : 
                                 'Pronto'}
                              </span>
                            </div>
                            
                            <div className="bg-white p-3 rounded">
                              {order.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-sm mb-1">
                                  <span>{item.qty}x {item.name}</span>
                                  <span className="font-semibold">€ {(item.price * item.qty).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}

                        {/* Totale e Pagamento */}
                        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-6 rounded-lg">
                          <div className="flex justify-between items-center mb-4">
                            <span className="text-xl font-semibold">Totale Tavolo:</span>
                            <span className="text-3xl font-bold">€ {totalAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => printTableBill(selectedTableForPayment)}
                              className="flex-1 bg-white text-blue-600 py-3 rounded-lg font-bold hover:bg-blue-50 transition flex items-center justify-center gap-2 text-sm"
                            >
                              🖨️ Stampa Conto
                            </button>
                            <button
                              onClick={() => markAsPaid(selectedTableForPayment)}
                              className="flex-1 bg-green-500 text-white py-3 rounded-lg font-bold hover:bg-green-600 transition flex items-center justify-center gap-2 text-sm"
                            >
                              <DollarSign size={20} /> Pagato
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // CAMERIERE
  // ========================================
  if (role === 'cameriere' || role === 'cameriere_bar' || role === 'admin') {
    const visibleMenu = menu.filter(d => !hiddenDishes.includes(d.id));
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 p-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-orange-900">🍽️ Cameriere - Ordini</h1>
            <button onClick={logout} className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
              <LogOut size={18} /> Esci
            </button>
          </div>

          {/* Notifiche Ordini Pronti */}
          {notifications.length > 0 && (
            <div className="mb-6 space-y-2">
              {notifications.map(notif => (
                <div 
                  key={notif.id} 
                  className={`p-4 rounded-lg shadow-lg flex justify-between items-center animate-pulse ${
                    notif.type === 'cucina' ? 'bg-red-100 border-2 border-red-500' : 'bg-cyan-100 border-2 border-cyan-500'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{notif.type === 'cucina' ? '👨‍🍳' : '🍹'}</span>
                    <div>
                      <p className="font-bold text-gray-800">{notif.message}</p>
                      <p className="text-sm text-gray-600">Ordine #{notif.orderId}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => closeNotification(notif.id)}
                    className="bg-white px-4 py-2 rounded-lg font-semibold hover:bg-gray-100 transition text-sm"
                  >
                    ✓ OK
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sezione Tavoli */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-lg p-6 sticky top-4">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Tavoli</h2>
                <div className="grid grid-cols-3 gap-2">
                  {tables.map(table => (
                    <button 
                      key={table.id} 
                      onClick={() => setSelectedTable(table.id)} 
                      className={`p-3 rounded-lg font-bold text-sm transition ${
                        selectedTable === table.id 
                          ? 'bg-blue-500 text-white' 
                          : getTableAllOrders(table.id).length > 0 
                          ? 'bg-orange-100 text-orange-800 hover:bg-orange-200' 
                          : 'bg-green-100 text-green-800 hover:bg-green-200'
                      }`}
                    >
                      T{table.id}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-gray-600 mt-4">
                  Selezionato: {selectedTable ? `T${selectedTable}` : 'Nessuno'}
                </p>
              </div>
            </div>

            {/* Sezione Ordini */}
            <div className="lg:col-span-2">
              {/* Nuovo Ordine */}
              <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">Nuovo Ordine T{selectedTable || '-'}</h2>
                  <button 
                    onClick={() => setShowMenu(!showMenu)} 
                    className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition text-sm"
                  >
                    {showMenu ? <EyeOff size={18} /> : <Eye size={18} />} {showMenu ? 'Nascondi' : 'Menu'}
                  </button>
                </div>

                {/* Menu Piatti */}
                {showMenu && (
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg max-h-64 overflow-y-auto">
                    {visibleMenu.length === 0 ? (
                      <p className="text-gray-500">Nessun piatto disponibile</p>
                    ) : (
                      <div className="space-y-4">
                        {MENU_CATEGORIES.map(category => {
                          const dishesInCategory = visibleMenu.filter(d => d.category === category);
                          const categoryColors = {
                            'Coperti': 'border-gray-500 bg-gray-50',
                            'Antipasti': 'border-purple-500 bg-purple-50',
                            'Primi': 'border-blue-500 bg-blue-50',
                            'Secondi': 'border-amber-500 bg-amber-50',
                            'Contorni': 'border-green-500 bg-green-50',
                            'Dessert': 'border-pink-500 bg-pink-50',
                            'Bibite': 'border-cyan-500 bg-cyan-50',
                            'Birre': 'border-yellow-500 bg-yellow-50',
                            'Vini': 'border-red-500 bg-red-50',
                            'Bar': 'border-indigo-500 bg-indigo-50'
                          };
                          if (dishesInCategory.length === 0) return null;
                          return (
                            <div key={category}>
                              <h4 className="font-bold text-gray-700 text-sm mb-2">{category}</h4>
                              <div className="space-y-2">
                                {dishesInCategory.map(dish => (
                                  <button 
                                    key={dish.id} 
                                    onClick={() => addToOrder(dish)} 
                                    className={`w-full text-left p-3 rounded-lg hover:opacity-80 transition border-l-4 text-sm ${categoryColors[category]}`}
                                  >
                                    <div className="flex justify-between">
                                      <span className="font-semibold">{dish.name}</span>
                                      <span className="font-bold">€ {dish.price.toFixed(2)}</span>
                                    </div>
                                    {dish.notes && <p className="text-xs text-blue-600 mt-1">ℹ️ {dish.notes}</p>}
                                    {dish.allergens && <p className="text-xs text-red-600 mt-1">⚠️ {dish.allergens}</p>}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Articoli Ordinati */}
                <div className="space-y-3 mb-6">
                  {currentOrderItems.length === 0 ? (
                    <p className="text-gray-500">Nessun articolo</p>
                  ) : (
                    currentOrderItems.map((item, idx) => (
                      <div key={idx} className="bg-gray-50 p-3 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <p className="font-semibold text-gray-800 text-sm">{item.name}</p>
                            <p className="text-sm text-green-600">€ {(item.price * item.qty).toFixed(2)}</p>
                          </div>
                          <button 
                            onClick={() => removeFromOrder(idx)} 
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                        <div className="flex gap-2 mb-2">
                          <button 
                            onClick={() => updateQuantity(idx, item.qty - 1)} 
                            className="px-2 py-1 bg-gray-300 rounded text-sm"
                          >
                            -
                          </button>
                          <input 
                            type="number" 
                            value={item.qty} 
                            onChange={(e) => updateQuantity(idx, parseInt(e.target.value))} 
                            className="w-12 p-1 border rounded text-center text-sm" 
                          />
                          <button 
                            onClick={() => updateQuantity(idx, item.qty + 1)} 
                            className="px-2 py-1 bg-gray-300 rounded text-sm"
                          >
                            +
                          </button>
                        </div>
                        <input 
                          type="text" 
                          placeholder="Note (es. senza cipolla)" 
                          value={item.notes} 
                          onChange={(e) => updateNotes(idx, e.target.value)} 
                          className="w-full p-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" 
                        />
                      </div>
                    ))
                  )}
                </div>

                {/* Totale e Salva */}
                {currentOrderItems.length > 0 && (
                  <>
                    <div className="bg-blue-50 p-4 rounded-lg mb-4">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold text-gray-800">Totale:</span>
                        <span className="text-2xl font-bold text-green-600">
                          € {currentOrderItems.reduce((sum, item) => sum + item.price * item.qty, 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <button 
                      onClick={saveOrder} 
                      disabled={!selectedTable} 
                      className="w-full bg-green-500 text-white py-3 rounded-lg font-semibold hover:bg-green-600 transition disabled:bg-gray-400"
                    >
                      ✓ Salva Ordine
                    </button>
                  </>
                )}
              </div>

              {/* Storico Ordini */}
              {selectedTable && (
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h3 className="text-xl font-semibold text-gray-800 mb-4">Storico Ordini - Tavolo {selectedTable}</h3>
                  
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {getTableAllOrders(selectedTable).length === 0 ? (
                      <p className="text-gray-500 text-center py-4">Nessun ordine in sospeso</p>
                    ) : (
                      <>
                        {getTableAllOrders(selectedTable).map(order => {
                          // Identifica se è ordine cucina o bar
                          const isKitchenOrder = order.id.endsWith('-k');
                          const isBarOrder = order.id.endsWith('-b');
                          const isAnnullato = order.status === 'annullato';
                          
                          return (
                          <div 
                            key={order.id} 
                            className={`border-l-4 p-3 rounded-lg text-sm ${
                              isAnnullato ? 'bg-gray-200 border-gray-600 opacity-60' :
                              order.status === 'in_attesa' && isKitchenOrder ? 'bg-gray-50 border-gray-400' :
                              order.status === 'nuovo' ? 'bg-red-50 border-red-500' :
                              order.status === 'in_preparazione' ? 'bg-yellow-50 border-yellow-500' :
                              'bg-green-50 border-green-500'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-600">{order.timestamp}</span>
                                {isBarOrder && <span className="text-xs bg-cyan-200 text-cyan-800 px-1 rounded">🍹</span>}
                                {isKitchenOrder && <span className="text-xs bg-red-200 text-red-800 px-1 rounded">🍽️</span>}
                              </div>
                              <span className={`text-xs px-2 py-1 rounded font-semibold ${
                                isAnnullato ? 'bg-gray-400 text-white' :
                                order.status === 'in_attesa' && isKitchenOrder ? 'bg-gray-200 text-gray-800' :
                                order.status === 'nuovo' ? 'bg-red-200 text-red-800' :
                                order.status === 'in_preparazione' ? 'bg-yellow-200 text-yellow-800' :
                                'bg-green-200 text-green-800'
                              }`}>
                                {isAnnullato ? '❌ Annullato' :
                                 order.status === 'in_attesa' && isKitchenOrder ? '⏸️ In Attesa' : 
                                 order.status === 'nuovo' ? '🆕 Nuovo' : 
                                 order.status === 'in_preparazione' ? '⏳ In Prep' : 
                                 '✓ Pronto'}
                              </span>
                            </div>
                            <div className="space-y-1 mb-2">
                              {order.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-xs">
                                  <span>{item.qty}x {item.name}</span>
                                  <span className="font-semibold">€ {(item.price * item.qty).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                            {/* Bottoni azione */}
                            {!isAnnullato && (
                              <div className="flex gap-2">
                                {/* Bottone "Da Preparare" SOLO per ordini CUCINA in attesa */}
                                {order.status === 'in_attesa' && isKitchenOrder && (
                                  <>
                                    <button
                                      onClick={() => approveKitchenOrder(order.id)}
                                      className="flex-1 bg-blue-500 text-white py-2 px-3 rounded font-semibold hover:bg-blue-600 transition text-xs flex items-center justify-center gap-1"
                                    >
                                      ▶️ Da Preparare
                                    </button>
                                    <button
                                      onClick={() => cancelOrder(order.id)}
                                      className="bg-red-500 text-white py-2 px-3 rounded font-semibold hover:bg-red-600 transition text-xs"
                                    >
                                      ❌
                                    </button>
                                  </>
                                )}
                                {/* Bottone annulla per ordini bar in attesa */}
                                {order.status === 'in_attesa' && isBarOrder && (
                                  <button
                                    onClick={() => cancelOrder(order.id)}
                                    className="w-full bg-red-500 text-white py-2 px-3 rounded font-semibold hover:bg-red-600 transition text-xs"
                                  >
                                    ❌ Annulla Ordine
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                        })}
                        
                        {/* Totale Finale */}
                        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-4 rounded-lg mt-4">
                          <div className="flex justify-between items-center">
                            <span className="text-lg font-semibold">Totale Tavolo:</span>
                            <span className="text-2xl font-bold">€ {calculateTableTotal(selectedTable).toFixed(2)}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // CUCINA
  // ========================================
  if (role === 'cucina' || role === 'admin') {
    // Ordina gli ordini dal più recente al meno recente
    const sortedKitchenOrders = [...kitchenOrders].sort((a, b) => {
      return b.id.localeCompare(a.id);
    });

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 p-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-red-900">👨‍🍳 Terminale Cucina</h1>
            <button onClick={logout} className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
              <LogOut size={18} /> Esci
            </button>
          </div>

          {sortedKitchenOrders.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow-lg">
              <p className="text-2xl text-gray-500">✨ Nessun ordine in attesa</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedKitchenOrders.map(order => (
                <div 
                  key={order.id} 
                  className={`p-6 rounded-lg shadow-lg ${
                    order.status === 'annullato' ? 'bg-gray-200 border-4 border-gray-500' :
                    order.status === 'in_attesa' ? 'bg-gray-100 border-4 border-gray-400' :
                    order.status === 'nuovo' ? 'bg-red-100 border-4 border-red-500' : 
                    order.status === 'in_preparazione' ? 'bg-yellow-100 border-4 border-yellow-500' : 
                    'bg-green-100 border-4 border-green-500'
                  }`}
                >
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-2xl font-bold text-gray-800">Tavolo {order.tableId}</h3>
                    <span className="text-xs text-gray-600">{order.timestamp}</span>
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="bg-white p-2 rounded">
                        <p className="font-semibold text-gray-800 text-sm">{item.qty}x {item.name}</p>
                        {item.notes && <p className="text-xs text-red-600 font-semibold">📝 {item.notes}</p>}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    {order.status === 'annullato' && (
                      <div className="flex-1 bg-gray-500 text-white py-2 rounded-lg font-semibold text-center">
                        ❌ Annullato
                      </div>
                    )}
                    {order.status === 'in_attesa' && (
                      <div className="flex-1 bg-gray-400 text-white py-2 rounded-lg font-semibold text-center">
                        ⏸️ In Attesa Cameriere
                      </div>
                    )}
                    {order.status === 'nuovo' && (
                      <button 
                        onClick={() => updateKitchenOrderStatus(order.id, 'in_preparazione')} 
                        className="flex-1 bg-yellow-500 text-white py-2 rounded-lg font-semibold hover:bg-yellow-600 transition flex items-center justify-center gap-2"
                      >
                        <Clock size={18} /> In Prep
                      </button>
                    )}
                    {order.status === 'in_preparazione' && (
                      <>
                        <button 
                          onClick={() => goBackOrderStatus(order.id, true)} 
                          className="bg-gray-400 text-white py-2 px-3 rounded-lg font-semibold hover:bg-gray-500 transition text-sm"
                        >
                          ⬅️
                        </button>
                        <button 
                          onClick={() => updateKitchenOrderStatus(order.id, 'pronto')} 
                          className="flex-1 bg-green-500 text-white py-2 rounded-lg font-semibold hover:bg-green-600 transition flex items-center justify-center gap-2"
                        >
                          <Check size={18} /> Pronto!
                        </button>
                      </>
                    )}
                    {order.status === 'pronto' && (
                      <>
                        <button 
                          onClick={() => goBackOrderStatus(order.id, true)} 
                          className="bg-gray-400 text-white py-2 px-3 rounded-lg font-semibold hover:bg-gray-500 transition text-sm"
                        >
                          ⬅️
                        </button>
                        <div className="flex-1 bg-green-500 text-white py-2 rounded-lg font-semibold text-center">✓ Pronto</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========================================
  // BAR
  // ========================================
  if (role === 'bar' || role === 'cameriere_bar' || role === 'admin') {
    // Ordina gli ordini dal più recente al meno recente
    const sortedBarOrders = [...barOrders].sort((a, b) => {
      return b.id.localeCompare(a.id);
    });

    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-cyan-100 p-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-cyan-900">🍹 Terminale Bar</h1>
            <button onClick={logout} className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
              <LogOut size={18} /> Esci
            </button>
          </div>

          {sortedBarOrders.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow-lg">
              <p className="text-2xl text-gray-500">✨ Nessuna bevanda in attesa</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedBarOrders.map(order => (
                <div 
                  key={order.id} 
                  className={`p-6 rounded-lg shadow-lg ${
                    order.status === 'annullato' ? 'bg-gray-200 border-4 border-gray-500' :
                    order.status === 'nuovo' ? 'bg-cyan-100 border-4 border-cyan-500' : 
                    order.status === 'in_preparazione' ? 'bg-blue-100 border-4 border-blue-500' : 
                    'bg-green-100 border-4 border-green-500'
                  }`}
                >
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-2xl font-bold text-gray-800">Tavolo {order.tableId}</h3>
                    <span className="text-xs text-gray-600">{order.timestamp}</span>
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="bg-white p-2 rounded">
                        <p className="font-semibold text-gray-800 text-sm">{item.qty}x {item.name}</p>
                        {item.notes && <p className="text-xs text-red-600 font-semibold">📝 {item.notes}</p>}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    {order.status === 'annullato' && (
                      <div className="flex-1 bg-gray-500 text-white py-2 rounded-lg font-semibold text-center">
                        ❌ Annullato
                      </div>
                    )}
                    {order.status === 'nuovo' && (
                      <button 
                        onClick={() => updateBarOrderStatus(order.id, 'in_preparazione')} 
                        className="flex-1 bg-blue-500 text-white py-2 rounded-lg font-semibold hover:bg-blue-600 transition flex items-center justify-center gap-2"
                      >
                        <Clock size={18} /> In Prep
                      </button>
                    )}
                    {order.status === 'in_preparazione' && (
                      <>
                        <button 
                          onClick={() => goBackOrderStatus(order.id, false)} 
                          className="bg-gray-400 text-white py-2 px-3 rounded-lg font-semibold hover:bg-gray-500 transition text-sm"
                        >
                          ⬅️
                        </button>
                        <button 
                          onClick={() => updateBarOrderStatus(order.id, 'pronto')} 
                          className="flex-1 bg-green-500 text-white py-2 rounded-lg font-semibold hover:bg-green-600 transition flex items-center justify-center gap-2"
                        >
                          <Check size={18} /> Pronto!
                        </button>
                      </>
                    )}
                    {order.status === 'pronto' && (
                      <>
                        <button 
                          onClick={() => goBackOrderStatus(order.id, false)} 
                          className="bg-gray-400 text-white py-2 px-3 rounded-lg font-semibold hover:bg-gray-500 transition text-sm"
                        >
                          ⬅️
                        </button>
                        <div className="flex-1 bg-green-500 text-white py-2 rounded-lg font-semibold text-center">✓ Pronto</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========================================
  // LOGIN
  // ========================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-center text-gray-800 mb-2">🍽️ Ruppdiun</h1>
        <p className="text-center text-gray-600 mb-8">Gestionale Ristorante</p>
        
        {loginError && (
          <div className="bg-red-100 border-2 border-red-500 text-red-700 px-4 py-3 rounded mb-6 text-center font-semibold">
            {loginError}
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Accesso Amministratore */}
          <button 
            onClick={() => handleLogin('admin')} 
            className="bg-gradient-to-r from-purple-500 to-purple-600 text-white py-4 px-6 rounded-lg font-bold text-lg hover:from-purple-600 hover:to-purple-700 transition shadow-lg"
          >
            <div className="text-3xl mb-2">👑</div>
            <div>Amministratore</div>
            <div className="text-xs opacity-80 mt-1">Accesso Completo</div>
          </button>

          {/* Gestione Menu */}
          <button 
            onClick={() => handleLogin('menu')} 
            className="bg-gradient-to-r from-purple-400 to-pink-500 text-white py-4 px-6 rounded-lg font-bold text-lg hover:from-purple-500 hover:to-pink-600 transition shadow-lg"
          >
            <div className="text-3xl mb-2">📝</div>
            <div>Gestione Menu</div>
            <div className="text-xs opacity-80 mt-1">Solo Menu</div>
          </button>

          {/* Cameriere */}
          <button 
            onClick={() => handleLogin('cameriere')} 
            className="bg-gradient-to-r from-orange-500 to-orange-600 text-white py-4 px-6 rounded-lg font-bold text-lg hover:from-orange-600 hover:to-orange-700 transition shadow-lg"
          >
            <div className="text-3xl mb-2">🍽️</div>
            <div>Cameriere</div>
            <div className="text-xs opacity-80 mt-1">Gestione Tavoli</div>
          </button>

          {/* Cameriere + Bar */}
          <button 
            onClick={() => handleLogin('cameriere_bar')} 
            className="bg-gradient-to-r from-teal-500 to-cyan-600 text-white py-4 px-6 rounded-lg font-bold text-lg hover:from-teal-600 hover:to-cyan-700 transition shadow-lg"
          >
            <div className="text-3xl mb-2">🍹🍽️</div>
            <div>Cameriere + Bar</div>
            <div className="text-xs opacity-80 mt-1">Tavoli + Bevande</div>
          </button>

          {/* Cucina */}
          <button 
            onClick={() => handleLogin('cucina')} 
            className="bg-gradient-to-r from-red-500 to-red-600 text-white py-4 px-6 rounded-lg font-bold text-lg hover:from-red-600 hover:to-red-700 transition shadow-lg"
          >
            <div className="text-3xl mb-2">👨‍🍳</div>
            <div>Cucina</div>
            <div className="text-xs opacity-80 mt-1">Preparazione Piatti</div>
          </button>

          {/* Bar */}
          <button 
            onClick={() => handleLogin('bar')} 
            className="bg-gradient-to-r from-cyan-500 to-cyan-600 text-white py-4 px-6 rounded-lg font-bold text-lg hover:from-cyan-600 hover:to-cyan-700 transition shadow-lg"
          >
            <div className="text-3xl mb-2">🍹</div>
            <div>Bar</div>
            <div className="text-xs opacity-80 mt-1">Preparazione Bevande</div>
          </button>
        </div>

        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600 text-center mb-2">
            <strong>Password di default:</strong>
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div>• Admin: <code className="bg-gray-200 px-2 py-1 rounded">1234</code></div>
            <div>• Menu: <code className="bg-gray-200 px-2 py-1 rounded">menu123</code></div>
            <div>• Cameriere: <code className="bg-gray-200 px-2 py-1 rounded">cameriere123</code></div>
            <div>• Cam+Bar: <code className="bg-gray-200 px-2 py-1 rounded">cambar123</code></div>
            <div>• Cucina: <code className="bg-gray-200 px-2 py-1 rounded">cucina123</code></div>
            <div>• Bar: <code className="bg-gray-200 px-2 py-1 rounded">bar123</code></div>
          </div>
          <p className="text-xs text-gray-500 text-center mt-2 italic">
            Le password possono essere modificate nel codice
          </p>
        </div>
      </div>
    </div>
  );
}
