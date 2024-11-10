class ReceiptManager {
  constructor(rentalFee) {
    this.items = [];
    this.tipPercent = 0;
    this.ccSurcharge = false;
    this.taxRate = 0.13;
    this.rentalFee = rentalFee || 0;

    this.createDialog();
    this.initializeEventListeners();

    // Show the dialog after initialization
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
                    <div class="overflow-x-auto">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th class="text-left">Item</th>
                                    <th class="text-left">Quantity</th>
                                    <th class="text-left">Price</th>
                                    <th></th> <!-- For the add button -->
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>
                                        <input type="text" id="newItemName" placeholder="Item name" value="Rental"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td>
                                        <input type="number" id="newItemQty" placeholder="Qty" value="1" min="1"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td>
                                        <input type="number" id="newItemPrice" placeholder="Price" step="0.01"
                                               value="${((this.rentalFee/2)/1.13).toFixed(2)}"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td class="text-center">
                                        <button id="addItemBtn" class="btn btn-sm btn-ghost btn-square text-success">
                                            <span class="font-bold text-lg">+</span>
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Actions -->
                <div class="modal-action mt-6 print:hidden">
                    <button id="downloadReceiptBtn" class="btn btn-success gap-2">
                        Save as Image
                    </button>
                    <button id="printReceiptBtn" class="btn btn-primary">
                        Print
                    </button>
                    <form method="dialog">
                        <button class="btn">Close</button>
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


  // Rest of the methods remain the same
  initializeEventListeners() {
    // Add Item Button
    document.getElementById('addItemBtn').addEventListener('click', () => {
      this.handleAddItem();
    });

    // Add item on Enter key in price field
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
    // CC Surcharge Toggle
    document.getElementById('ccSurcharge').addEventListener('change', (e) => {
      this.ccSurcharge = e.target.checked;
      document.getElementById('ccLabel').textContent = this.ccSurcharge ? '(2.4%)' : '';
      this.updateTotals();
    });

    // Print Button
    document.getElementById('printReceiptBtn').addEventListener('click', () => {
      window.print();
    });

    // Download Button
    document.getElementById('downloadReceiptBtn').addEventListener('click', () => {
      this.downloadAsImage();
    });

    // Cleanup when dialog closes
    this.dialog.addEventListener('close', () => {
      this.dialog.remove();
      delete window.currentReceipt;
    });
  }

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

    const tip = (tipableAmount * this.tipPercent) / 100;
    const tax = subtotal * this.taxRate;
    const subtotalWithTipAndTax = subtotal + tip + tax;
    const surcharge = this.ccSurcharge ? subtotalWithTipAndTax * 0.024 : 0;
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
      alert('Could not generate receipt image. Please try printing instead.');
    }
  }
  

}