class ReceiptManager {
  constructor(rentalFee) {
    this.items = [];
    this.tipPercent = 0;
    this.ccSurcharge = false;
    this.taxRate = 0.13;
    this.rentalFee = rentalFee || 0;
    this.contactId = window.app.contacts.currentId;

    // Load existing receipt if it exists
    this.loadReceipt();
    this.createDialog();
    this.initializeEventListeners();
    this.dialog.showModal();
  }
  createDialog() {
    const dialogHtml = `
        <dialog id="receiptDialog" class="modal">
            <div class="modal-box max-w-2xl">
                <div id="receiptContent">
                    <!-- Header -->
                    <div class="text-center space-y-2 mt-6">
                        <p class="text-sm">I say taco, you say taco!</p>
                        <h1 class="font-bold text-2xl">TacoTaco</h1>
                        <p class="text-sm">319 Augusta Ave. Toronto ON M5T2M2</p>
                    </div>

                    <!-- Items List -->
                    <div class="space-y-4 mt-6">
                        <table class="table w-full" id="receiptItems">
                            <thead>
                                <tr>
                                    <th class="text-left">Item</th>
                                    <th class="text-right w-20">Qty</th>
                                    <th class="text-right w-24">Price</th>
                                    <th class="text-right w-24">Total</th>
                                    <th class="w-12"></th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>

                    <!-- Totals -->
                    <div class="space-y-2 border-t pt-4 mt-8">
                        <div class="flex justify-between">
                            <span>Subtotal</span>
                            <span id="subtotalAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between">
                            <span>Tip (<span id="tipPercentDisplay">0</span>%)</span>
                            <span id="tipAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <span>CC Surcharge <span id="ccLabel"></span></span>
                                <input type="checkbox" id="ccSurcharge" class="checkbox checkbox-sm print:hidden">
                            </label>
                            <span id="surchargeAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between">
                            <span>Tax (13%)</span>
                            <span id="taxAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between font-bold text-lg border-t pt-2">
                            <span>Total</span>
                            <span id="totalAmount">$0.00</span>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div class="text-center text-sm space-y-1 mt-8">
                        <div>eattaco.ca@tacotacoto</div>
                        <div>GST/HST #: 773762067RT0001</div>
                    </div>
                </div> <!-- End of #receiptContent -->

                <!-- Controls Section -->
                <div class="border-t mt-8 pt-4 print:hidden">
                    <h3 class="font-semibold text-lg mb-4">Receipt Controls</h3>

                    <!-- Tip Selection -->
                    <div class="mb-4">
                        <div class="flex items-center gap-2">
                            <span class="w-24">Tip Amount:</span>
                            <select id="tipPercent" class="select select-bordered select-sm">
                                <option value="0">0%</option>
                                <option value="10">10%</option>
                                <option value="15">15%</option>
                                <option value="18">18%</option>
                                <option value="20">20%</option>
                            </select>
                        </div>
                    </div>

                    <!-- Input Fields as Table -->
                   <!-- Input Fields as Responsive Grid -->
                  <div class="overflow-x-auto">
                      <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
                          <!-- Item Name -->
                          <div class="flex flex-col">
                              <label for="newItemName" class="sr-only">Item Name</label>
                              <input type="text" id="newItemName" placeholder="Item name" value="Rental"
                                    class="input input-bordered input-sm w-full" />
                          </div>
                          
                          <!-- Quantity -->
                          <div class="flex flex-col">
                              <label for="newItemQty" class="sr-only">Quantity</label>
                              <input type="number" id="newItemQty" placeholder="Qty" value="1" min="1"
                                    class="input input-bordered input-sm w-full" />
                          </div>
                          
                          <!-- Price -->
                          <div class="flex flex-col">
                              <label for="newItemPrice" class="sr-only">Price</label>
                              <input type="number" id="newItemPrice" placeholder="Price" step="0.01"
                                    value="${((this.rentalFee/2)/1.13).toFixed(2)}"
                                    class="input input-bordered input-sm w-full" />
                          </div>
                          
                          <!-- Add Button -->
                          <div class="flex items-center justify-center">
                              <button id="addItemBtn" class="btn btn-sm btn-ghost btn-square text-success">
                                  <span class="font-bold text-lg">+</span>
                              </button>
                          </div>
                      </div>
                  </div>

                </div>

                <!-- Action buttons -->
                <div class="modal-action mt-6 print:hidden flex flex-wrap gap-2">
                    <button id="saveReceiptBtn" class="btn btn-sm md:btn-md btn-primary gap-2">
                        <i class="bi bi-save"></i> <span class="hidden sm:inline">Save</span> Receipt
                    </button>
                    <button id="resetReceiptBtn" class="btn btn-sm md:btn-md btn-error gap-2">
                        <i class="bi bi-trash"></i> <span class="hidden sm:inline">Reset</span>
                    </button>
                    <button id="downloadReceiptBtn" class="btn btn-sm md:btn-md btn-success gap-2">
                        <i class="bi bi-download"></i> Save as Image
                    </button>
                    <button id="printReceiptBtn" class="btn btn-sm md:btn-md btn-info gap-2">
                        <i class="bi bi-printer"></i> <span class="hidden sm:inline">Print</span>
                    </button>
                    <form method="dialog">
                        <button class="btn btn-sm md:btn-md">Close</button>
                    </form>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    `;

    document.body.insertAdjacentHTML('beforeend', dialogHtml);
    this.dialog = document.getElementById('receiptDialog');
}

  async loadReceipt() {
    try {
      const contact = window.app.contacts.getContactById(this.contactId);
      if (contact && contact.receipt) {
        this.items = contact.receipt.items || [];
        this.tipPercent = contact.receipt.tipPercent || 0;
        this.ccSurcharge = contact.receipt.ccSurcharge || false;
        
        // Update UI after loading
        setTimeout(() => {
          this.renderItems();
          this.updateTotals();
          document.getElementById('tipPercent').value = this.tipPercent;
          document.getElementById('ccSurcharge').checked = this.ccSurcharge;
        }, 100);
      }
    } catch (error) {
      console.error('Error loading receipt:', error);
      window.app.showToast('Error loading receipt', 'error');
    }
  }

  async saveReceipt() {
    try {
      const receiptData = {
        items: this.items,
        tipPercent: this.tipPercent,
        ccSurcharge: this.ccSurcharge,
        lastUpdated: new Date().toISOString()
      };

      const contact = window.app.contacts.getContactById(this.contactId);
      if (!contact) {
        throw new Error('No contact selected');
      }

      contact.receipt = receiptData;

      const response = await fetch(`/api/events/${this.contactId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(contact)
      });

      if (!response.ok) {
        throw new Error('Failed to save receipt');
      }

      window.app.showToast('Receipt saved successfully', 'success');
    } catch (error) {
      console.error('Error saving receipt:', error);
      window.app.showToast('Error saving receipt', 'error');
    }
  }

  resetReceipt() {
    this.items = [];
    this.tipPercent = 0;
    this.ccSurcharge = false;
    
    // Reset UI
    document.getElementById('tipPercent').value = "0";
    document.getElementById('ccSurcharge').checked = false;
    document.getElementById('tipPercentDisplay').textContent = "0";
    
    this.renderItems();
    this.updateTotals();
    
    window.app.showToast('Receipt reset', 'success');
  }

  initializeEventListeners() {
    // Existing event listeners
    document.getElementById('addItemBtn').addEventListener('click', () => {
      this.handleAddItem();
    });

    document.getElementById('newItemPrice').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleAddItem();
      }
    });

    document.getElementById('tipPercent').addEventListener('change', (e) => {
      this.tipPercent = parseInt(e.target.value);
      document.getElementById('tipPercentDisplay').textContent = this.tipPercent;
      this.updateTotals();
    });
    
    document.getElementById('ccSurcharge').addEventListener('change', (e) => {
      this.ccSurcharge = e.target.checked;
      document.getElementById('ccLabel').textContent = this.ccSurcharge ? '(2.4%)' : '';
      this.updateTotals();
    });

    // New event listeners for save/reset functionality
    document.getElementById('saveReceiptBtn').addEventListener('click', () => {
      this.saveReceipt();
    });

    document.getElementById('resetReceiptBtn').addEventListener('click', () => {
      if (confirm('Are you sure you want to reset this receipt? This cannot be undone.')) {
        this.resetReceipt();
      }
    });

    document.getElementById('printReceiptBtn').addEventListener('click', () => {
      window.print();
    });

    document.getElementById('downloadReceiptBtn').addEventListener('click', () => {
      this.downloadAsImage();
    });

    this.dialog.addEventListener('close', () => {
      this.dialog.remove();
      delete window.currentReceipt;
    });
  }

  // Rest of the existing methods remain the same
  handleAddItem() {
    const nameInput = document.getElementById('newItemName');
    const qtyInput = document.getElementById('newItemQty');
    const priceInput = document.getElementById('newItemPrice');

    const name = nameInput.value;
    const quantity = parseInt(qtyInput.value);
    const price = parseFloat(priceInput.value);

    if (name && quantity > 0 && price >= 0) {
      this.addItem({ name, quantity, price });
      nameInput.value = 'Rental';
      qtyInput.value = '1';
      priceInput.value = this.rentalFee.toFixed(2);
      priceInput.focus();
    }
  }

  addItem({ name, quantity, price }) {
    const item = { name, quantity, price, id: Date.now() };
    this.items.push(item);
    this.renderItems();
    this.updateTotals();
  }

  removeItem(itemId) {
    this.items = this.items.filter(item => item.id !== itemId);
    this.renderItems();
    this.updateTotals();
  }

  renderItems() {
    const tbody = document.querySelector('#receiptItems tbody');
    const itemsHtml = this.items.map(item => `
      <tr class="border-b">
        <td class="p-2">${item.name}</td>
        <td class="text-right p-2">${item.quantity}</td>
        <td class="text-right p-2">$${item.price.toFixed(2)}</td>
        <td class="text-right p-2">$${(item.quantity * item.price).toFixed(2)}</td>
        <td class="text-right p-2 print:hidden">
          <button onclick="window.currentReceipt.removeItem(${item.id})" class="text-red-600 hover:text-red-700">
            <i class="bi bi-x"></i>
          </button>
        </td>
      </tr>
    `).join('');

    tbody.innerHTML = itemsHtml;
  }

  updateTotals() {
    const subtotal = this.items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const tipableAmount = this.items
      .filter(item => item.name.toLowerCase() !== 'rental')
      .reduce((sum, item) => sum + (item.quantity * item.price), 0);

    // Calculate tax only on items containing "Drink Tickets"
    const taxableAmount = this.items
      .filter(item => item.name.toLowerCase().includes('drink tickets')||item.name.toLowerCase().includes('rental'))
      .reduce((sum, item) => sum + (item.quantity * item.price), 0);

    const tip = (tipableAmount * this.tipPercent) / 100;
    const tax = taxableAmount * this.taxRate;
    const subtotalWithTipAndTax = subtotal + tip + tax;
    const surcharge = this.ccSurcharge ? subtotal * 0.027 : 0;
    const total = subtotalWithTipAndTax + surcharge;

    document.getElementById('subtotalAmount').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('tipAmount').textContent = `$${tip.toFixed(2)}`;
    document.getElementById('taxAmount').textContent = `$${tax.toFixed(2)}`;
    document.getElementById('surchargeAmount').textContent = `$${surcharge.toFixed(2)}`;
    document.getElementById('totalAmount').textContent = `$${total.toFixed(2)}`;
  }
  async downloadAsImage() {
    try {
      const element = document.getElementById('receiptContent');
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      });
  
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `Receipt-${new Date().toISOString().split('T')[0]}.png`;
      link.href = image;
      link.click();
    } catch (error) {
      console.error('Error generating image:', error);
      window.app.showToast('Could not generate receipt image', 'error');
    }
  }
}