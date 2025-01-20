// script.js

// Get references to DOM elements
const grid = document.getElementById('grid');
const gridSize = 40; // 40x40 grid by default
let currentObject = null; // For placing NEW objects

// Counters for HQs and Bear Traps
let hqCount = 0;
let bearTrapCount = 0;

// The array that stores all placed objects
let placedObjects = [];

// Drag & Drop variables
let isDragging = false;
let draggedObject = null;        // The object from placedObjects being dragged
let dragOriginalPosition = null; // {row, col} before dragging
let dragOffset = {row: 0, col: 0}; 
const dragGhost = document.getElementById('drag-ghost'); // Hidden ghost div

// Naming / Label variables
let isNamingMode = false;
let showNames = true;

// Set up the "Show Names" checkbox
document.getElementById('toggle-names').addEventListener('change', (e) => {
  showNames = e.target.checked;
  refreshGrid();
});

// "Set Name" button => next click on a tile sets a name
document.getElementById('set-name').addEventListener('click', () => {
  isNamingMode = true;
});

// ---------- Initialize the grid ----------
function createGrid() {
  for (let i = 0; i < gridSize * gridSize; i++) {
    const tile = document.createElement('div');
    tile.classList.add('tile');
    tile.dataset.index = i;
    
    // We'll use mousedown to possibly start a drag or naming
    tile.addEventListener('mousedown', handleTileMouseDown);
    grid.appendChild(tile);
  }

  // Listen for mousemove/up at document level for dragging
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

// Refresh the entire grid visually, re-placing all objects
function refreshGrid() {
  clearGridVisualOnly();
  for (const obj of placedObjects) {
    placeObjectOnGrid(obj.row, obj.col, obj.className, obj.size, obj);
  }
}

// ---------- Mouse event handlers ----------

// If we have a new object selected, place it. Otherwise, maybe drag or name an existing object.
function handleTileMouseDown(e) {
  if (currentObject) {
    // Place new object
    handleTileClick(e);
    return;
  }
  
  if (isNamingMode) {
    // Name an existing object
    handleNameSetting(e);
    return;
  }

  // Otherwise, check if user clicked an existing object => begin drag
  const tileIndex = parseInt(e.target.dataset.index);
  const row = Math.floor(tileIndex / gridSize);
  const col = tileIndex % gridSize;
  
  const obj = findObjectAt(row, col);
  if (obj) {
    isDragging = true;
    draggedObject = obj;
    dragOriginalPosition = { row: obj.row, col: obj.col };
    
    // If user clicked in the middle of the object, record offset
    dragOffset.row = row - obj.row;
    dragOffset.col = col - obj.col;
    
    removeObjectFromGrid(obj);
    showDragGhost(obj);
    
    // Prevent default to avoid text selection or image dragging
    e.preventDefault();
  }
}

// For placing a brand-new object by clicking on a tile
function handleTileClick(event) {
  if (!currentObject) return;

  if (currentObject.className === 'hq' && hqCount >= 1) {
    alert('Only 1 HQ is allowed on the grid.');
    return;
  }
  if (currentObject.className === 'bear-trap' && bearTrapCount >= 2) {
    alert('Only 2 Bear Traps are allowed on the grid.');
    return;
  }

  const tileIndex = parseInt(event.target.dataset.index);
  const row = Math.floor(tileIndex / gridSize);
  const col = tileIndex % gridSize;

  // Attempt to place it
  if (canPlaceObject(row, col, currentObject.size)) {
    placeObjectOnGrid(row, col, currentObject.className, currentObject.size, currentObject);

    // Add to placedObjects
    placedObjects.push({
      row,
      col,
      size: currentObject.size,
      className: currentObject.className
    });

    // Update counters
    if (currentObject.className === 'hq') hqCount++;
    if (currentObject.className === 'bear-trap') bearTrapCount++;

    // **** Only clear currentObject if Shift is NOT held ****
    if (!event.shiftKey) {
      currentObject = null;
    }

  } else {
    alert('Invalid placement!');
  }
}

// Mouse move => if we are dragging, move the ghost + highlight coverage
function handleMouseMove(e) {
  if (!isDragging || !draggedObject) return;

  // 1) Find which tile the mouse is over
  const tileUnderMouse = getTileFromMouseEvent(e);

  // 2) Clear real-time coverage from last frame
  clearRealTimeCoverage();

  // 3) If inside the grid, compute top-left of the object
  if (tileUnderMouse) {
    const newRow = tileUnderMouse.row - dragOffset.row;
    const newCol = tileUnderMouse.col - dragOffset.col;

    // If in range, highlight territory or border
    if (
      newRow >= 0 && 
      newCol >= 0 && 
      newRow + draggedObject.size <= gridSize &&
      newCol + draggedObject.size <= gridSize
    ) {
      // HQ or banner coverage
      if (draggedObject.className === 'hq') {
        highlightTerritory(newRow + 1, newCol + 1, 7);
      } else if (draggedObject.className === 'banner') {
        highlightTerritory(newRow, newCol, 3);
      }
      // Border preview
      highlightObjectBorder(newRow, newCol, draggedObject.size);
    }

    // Position ghost in alignment with the grid
    const rect = grid.getBoundingClientRect();
    dragGhost.style.left = (rect.left + newCol * 20) + 'px';
    dragGhost.style.top  = (rect.top  + newRow * 20) + 'px';
  } else {
    // If outside the grid, either move ghost to cursor or hide, etc.
    dragGhost.style.left = e.pageX + 'px';
    dragGhost.style.top  = e.pageY + 'px';
  }
}

// Mouse up => finalize or revert drag
function handleMouseUp(e) {
  if (!isDragging || !draggedObject) return;

  isDragging = false;
  dragGhost.style.display = 'none';

  const tileUnderMouse = getTileFromMouseEvent(e);
  if (!tileUnderMouse) {
    // Dropped outside => revert
    placeObjectOnGrid(
      dragOriginalPosition.row, 
      dragOriginalPosition.col, 
      draggedObject.className, 
      draggedObject.size,
      draggedObject
    );
    draggedObject.row = dragOriginalPosition.row;
    draggedObject.col = dragOriginalPosition.col;
    draggedObject = null;
    return;
  }

  const newRow = tileUnderMouse.row - dragOffset.row;
  const newCol = tileUnderMouse.col - dragOffset.col;

  // Check collision/out of bounds
  if (!canPlaceObject(newRow, newCol, draggedObject.size)) {
    alert('Invalid placement! Overlaps or out of bounds.');
    // revert
    placeObjectOnGrid(
      dragOriginalPosition.row, 
      dragOriginalPosition.col, 
      draggedObject.className, 
      draggedObject.size,
      draggedObject
    );
    draggedObject.row = dragOriginalPosition.row;
    draggedObject.col = dragOriginalPosition.col;
    draggedObject = null;
    return;
  }

  // Valid => place at new location
  draggedObject.row = newRow;
  draggedObject.col = newCol;
  placeObjectOnGrid(newRow, newCol, draggedObject.className, draggedObject.size, draggedObject);

  draggedObject = null;
  clearRealTimeCoverage();
}

// ---------- Naming Logic ----------
function handleNameSetting(e) {
  isNamingMode = false; // consume naming mode

  const tileIndex = parseInt(e.target.dataset.index);
  const row = Math.floor(tileIndex / gridSize);
  const col = tileIndex % gridSize;

  // Find object
  const obj = findObjectAt(row, col);
  if (!obj) {
    alert('No object here to name.');
    return;
  }

  // Example: only allow naming for Furnaces
  const allowedClasses = ['furnace', 'hq', 'bear-trap'];
  if (!allowedClasses.includes(obj.className)) {
    alert('Naming is only supported for HQ, Bear Traps, and Furnaces.');
    return;
  }

  const newName = prompt('Enter a name for this furnace:', obj.name || '');
  if (newName === null) return; // user canceled
  
  obj.name = newName.trim();
  refreshGrid();
}

// ---------- Helper functions ----------

function findObjectAt(row, col) {
  for (let i = placedObjects.length - 1; i >= 0; i--) {
    const obj = placedObjects[i];
    if (
      row >= obj.row && row < obj.row + obj.size &&
      col >= obj.col && col < obj.col + obj.size
    ) {
      return obj;
    }
  }
  return null;
}

function removeObjectFromGrid(obj) {
  const tiles = document.querySelectorAll('.tile');
  for (let r = 0; r < obj.size; r++) {
    for (let c = 0; c < obj.size; c++) {
      const index = (obj.row + r) * gridSize + (obj.col + c);
      tiles[index].classList.remove(obj.className);
      tiles[index].classList.remove(
        'object-border-top','object-border-right',
        'object-border-bottom','object-border-left','covered'
      );
    }
  }
  // If HQ or banner, remove coverage visually
  clearGridVisualOnly();
  // Re-draw all except the one we're dragging
  for (const o of placedObjects) {
    if (o !== draggedObject) {
      placeObjectOnGrid(o.row, o.col, o.className, o.size, o);
    }
  }
}

function showDragGhost(obj) {
  dragGhost.innerHTML = '';
  for (let r = 0; r < obj.size; r++) {
    const rowDiv = document.createElement('div');
    rowDiv.style.display = 'flex';
    for (let c = 0; c < obj.size; c++) {
      const cell = document.createElement('div');
      cell.style.width = '20px';
      cell.style.height = '20px';
      cell.style.boxSizing = 'border-box';
      cell.style.border = '1px solid #999';
      cell.classList.add(obj.className);
      rowDiv.appendChild(cell);
    }
    dragGhost.appendChild(rowDiv);
  }
  dragGhost.style.display = 'block';
}

function getTileFromMouseEvent(e) {
  const rect = grid.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  if (x < 0 || y < 0) return null;
  const col = Math.floor(x / 20);
  const row = Math.floor(y / 20);
  
  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return null;
  return { row, col };
}

function clearRealTimeCoverage() {
  const tiles = document.querySelectorAll('.tile');
  tiles.forEach(tile => {
    if (!tile.classList.contains('bear-trap') &&
        !tile.classList.contains('hq') &&
        !tile.classList.contains('furnace') &&
        !tile.classList.contains('banner') &&
        !tile.classList.contains('resource-node') &&
        !tile.classList.contains('non-buildable-area')) {
      tile.classList.remove('covered');
    }
    tile.classList.remove(
      'object-border-top','object-border-right',
      'object-border-bottom','object-border-left'
    );
  });
  // Re-draw borders & coverage for existing objects
  for (const obj of placedObjects) {
    if (obj !== draggedObject) {
      applyObjectBorder(obj.row, obj.col, obj.size);
      if (obj.className === 'hq') highlightTerritory(obj.row + 1, obj.col + 1, 7);
      else if (obj.className === 'banner') highlightTerritory(obj.row, obj.col, 3);
    }
  }
}

function highlightObjectBorder(row, col, size) {
  const tiles = document.querySelectorAll('.tile');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (row + r) * gridSize + (col + c);
      const tile = tiles[index];
      if (!tile) continue;
      if (r === 0) tile.classList.add('object-border-top');
      if (r === size - 1) tile.classList.add('object-border-bottom');
      if (c === 0) tile.classList.add('object-border-left');
      if (c === size - 1) tile.classList.add('object-border-right');
    }
  }
}

function canPlaceObject(row, col, size) {
  if (row + size > gridSize || col + size > gridSize) return false;

  const tiles = document.querySelectorAll('.tile');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (row + r) * gridSize + (col + c);
      if (
        index >= tiles.length ||
        tiles[index].classList.contains('bear-trap') ||
        tiles[index].classList.contains('hq') ||
        tiles[index].classList.contains('furnace') ||
        tiles[index].classList.contains('banner') ||
        tiles[index].classList.contains('resource-node') ||
        tiles[index].classList.contains('non-buildable-area')
      ) {
        return false;
      }
    }
  }
  return true;
}

// ---------- Undo, Clear, Save, Load ----------
function undoLastPlacement() {
  if (placedObjects.length === 0) return;
  placedObjects.pop();
  recalculateCounters();
  clearGridVisualOnly();
  for (const obj of placedObjects) {
    placeObjectOnGrid(obj.row, obj.col, obj.className, obj.size, obj);
  }
}

function recalculateCounters() {
  hqCount = 0;
  bearTrapCount = 0;
  for (const obj of placedObjects) {
    if (obj.className === 'hq') hqCount++;
    if (obj.className === 'bear-trap') bearTrapCount++;
  }
}

function placeObjectOnGrid(row, col, className, size, obj) {
  const tiles = document.querySelectorAll('.tile');
  
  // Lay down the object's squares
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (row + r) * gridSize + (col + c);
      // Clear leftover text
      tiles[index].textContent = '';
      // Add class
      tiles[index].classList.add(className);
      // Remove coverage/borders
      tiles[index].classList.remove(
        'object-border-top','object-border-right',
        'object-border-bottom','object-border-left','covered'
      );
    }
  }
  applyObjectBorder(row, col, size);

  // HQ or banner coverage
  if (className === 'hq') {
    highlightTerritory(row + 1, col + 1, 7);
  } else if (className === 'banner') {
    highlightTerritory(row, col, 3);
  }

  // If showNames && the object has a name => create a label
  if (obj && showNames && obj.name) {
    const labelDiv = document.createElement('div');
    labelDiv.classList.add('name-label');
    labelDiv.textContent = obj.name;

    // position/size for the entire bounding box
    labelDiv.style.position = 'absolute';
    labelDiv.style.left = (col * 20) + 'px';
    labelDiv.style.top = (row * 20) + 'px';
    labelDiv.style.width = (size * 20) + 'px';
    labelDiv.style.height = (size * 20) + 'px';

    // center the text
    labelDiv.style.display = 'flex';
    labelDiv.style.alignItems = 'center';
    labelDiv.style.justifyContent = 'center';
    labelDiv.style.pointerEvents = 'none'; // so clicks pass through
    labelDiv.style.fontSize = '10px';

    grid.appendChild(labelDiv);
  }
}

function clearGrid() {
  const tiles = document.querySelectorAll('.tile');
  tiles.forEach(tile => {
    tile.className = 'tile';
    tile.dataset.name = '';
  });

  currentObject = null;
  hqCount = 0;
  bearTrapCount = 0;
  placedObjects = [];

  // Remove all name labels
  const nameLabels = document.querySelectorAll('.name-label');
  nameLabels.forEach(lbl => lbl.remove());
}

function clearGridVisualOnly() {
  const tiles = document.querySelectorAll('.tile');
  tiles.forEach(tile => {
    tile.className = 'tile';
    tile.dataset.name = '';
    tile.style.border = '';
    tile.textContent = '';
  });

  // Remove all "name-label" divs
  const nameLabels = document.querySelectorAll('.name-label');
  nameLabels.forEach(lbl => lbl.remove());
}

function saveLayout() {
  const layoutJSON = JSON.stringify(placedObjects);
  const blob = new Blob([layoutJSON], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'layout.json';
  link.click();
  URL.revokeObjectURL(url);
}

function loadLayout(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const loadedData = JSON.parse(e.target.result);
      placedObjects = loadedData;
      recalculateCounters();
      clearGridVisualOnly();
      for (const obj of placedObjects) {
        placeObjectOnGrid(obj.row, obj.col, obj.className, obj.size, obj);
      }
    } catch (err) {
      console.error('Error parsing layout JSON:', err);
      alert('Failed to load layout. Invalid JSON file?');
    }
  };
  reader.readAsText(file);
}

// Add black borders around the object’s perimeter
function applyObjectBorder(row, col, size) {
  const tiles = document.querySelectorAll('.tile');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (row + r) * gridSize + (col + c);
      const tile = tiles[index];
      if (r === 0) tile.classList.add('object-border-top');
      if (r === size - 1) tile.classList.add('object-border-bottom');
      if (c === 0) tile.classList.add('object-border-left');
      if (c === size - 1) tile.classList.add('object-border-right');
    }
  }
}

// Highlight coverage (e.g., for HQ or Banner)
function highlightTerritory(centerRow, centerCol, radius) {
  const tiles = document.querySelectorAll('.tile');
  for (let r = -radius; r <= radius; r++) {
    for (let c = -radius; c <= radius; c++) {
      const row = centerRow + r;
      const col = centerCol + c;
      if (
        row >= 0 && row < gridSize && 
        col >= 0 && col < gridSize
      ) {
        const index = row * gridSize + col;
        if (
          !tiles[index].classList.contains('bear-trap') &&
          !tiles[index].classList.contains('hq') &&
          !tiles[index].classList.contains('furnace') &&
          !tiles[index].classList.contains('banner') &&
          !tiles[index].classList.contains('resource-node') &&
          !tiles[index].classList.contains('non-buildable-area')
        ) {
          tiles[index].classList.add('covered');
        }
      }
    }
  }
}

// Choose which object to place next
function addObject(className, size) {
  currentObject = { className, size };
}

// ---------- Toolbar Button Listeners ----------
document.getElementById('undo').addEventListener('click', undoLastPlacement);
document.getElementById('add-bear-trap').addEventListener('click', () => addObject('bear-trap', 3));
document.getElementById('add-hq').addEventListener('click', () => addObject('hq', 3));
document.getElementById('add-furnace').addEventListener('click', () => addObject('furnace', 2));
document.getElementById('add-banner').addEventListener('click', () => addObject('banner', 1));
document.getElementById('add-resource-node').addEventListener('click', () => addObject('resource-node', 2));
document.getElementById('add-non-buildable').addEventListener('click', () => addObject('non-buildable-area', 1));
document.getElementById('clear-grid').addEventListener('click', clearGrid);
document.getElementById('save-layout').addEventListener('click', saveLayout);

// "Restore Layout" button => triggers hidden file input
document.getElementById('restore-layout').addEventListener('click', () => {
  document.getElementById('load-layout').click();
});
document.getElementById('load-layout').addEventListener('change', loadLayout);

// ---------- Initialize on page load ----------
createGrid();
