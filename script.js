// Bear Trap Planner v0.1 alpha

// References to DOM
const grid          = document.getElementById('grid');
const gridWrapper   = document.getElementById('grid-wrapper');
const gridSize      = 40; // 40x40
const dragGhost     = document.getElementById('drag-ghost');

let currentObject   = null;   // For placing NEW objects
let placedObjects   = [];     // All placed objects

// Counters for specific types
let hqCount         = 0;
let bearTrapCount   = 0;

// Mode flags
let isDragging      = false;
let draggedObject   = null;   // Which placed object is being dragged
let dragOriginalPos = null;   // {row, col} before drag started

let isDeleteMode    = false;
let isNamingMode    = false;
let showNames       = true;

let activeMode      = null; // 'place', 'delete', 'name'
let currentPlacementType = null; // e.g. 'bear-trap', 'hq', etc.

// Placement preview
let placementPreview = null;
let isValidPlacement = false;

// Delete highlight
let deleteHighlightElement = null;
let lastHoveredObject = null;

// Additional style injection for .placement-preview
const dynamicStyle = document.createElement('style');
dynamicStyle.textContent = `
  .placement-preview {
    position: absolute;
    pointer-events: none;
    opacity: 0.7;
    z-index: 2;
    border: 2px solid #00ff00;
  }
  .placement-preview.invalid {
    border-color: #ff0000;
    opacity: 0.5;
  }
`;
document.head.appendChild(dynamicStyle);

/* --------------------------------------------------
    Initialization
-------------------------------------------------- */
function createGrid() {
  for (let i = 0; i < gridSize * gridSize; i++) {
    const tile = document.createElement('div');
    tile.classList.add('tile');
    tile.dataset.index = i;

    // Mouse down could start a drag or naming
    tile.addEventListener('mousedown', handleTileMouseDown);

    grid.appendChild(tile);
  }

  // Listen for mousemove/up at the document level
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

function refreshGrid() {
  clearGridVisualOnly();

  // Toggle name visibility
  grid.classList.toggle('show-names', showNames);

  // Re-place each object
  placedObjects.forEach(obj => {
    placeObjectOnGrid(obj.row, obj.col, obj.className, obj.size, obj);
  });
  refreshLabelPositions();
}

/* --------------------------------------------------
    Mouse / Dragging
-------------------------------------------------- */
function handleTileMouseDown(e) {
  // 1) Delete mode?
  if (isDeleteMode) {
    const tile = getTileFromMouseEvent(e);
    if (!tile) return;

    const obj = findObjectAt(tile.row, tile.col);
    if (obj) {
      // Remove from placedObjects
      const index = placedObjects.indexOf(obj);
      if (index >= 0) {
        placedObjects.splice(index, 1);
        // Adjust counters
        if (obj.className === 'hq') hqCount--;
        if (obj.className === 'bear-trap') bearTrapCount--;
        // Refresh
        clearGridVisualOnly();
        refreshGrid();
      }
    }
    return;
  }

  // 2) Placing new object?
  if (currentObject) {
    handleTileClick(e);
    return;
  }

  // 3) Naming mode?
  if (isNamingMode) {
    handleNameSetting(e);
    return;
  }

  // 4) Otherwise, check if user wants to drag an existing object
  const tileIndex = parseInt(e.target.dataset.index);
  const row = Math.floor(tileIndex / gridSize);
  const col = tileIndex % gridSize;

  const obj = findObjectAt(row, col);
  if (obj) {
    isDragging         = true;
    draggedObject      = obj;
    dragOriginalPos    = { row: obj.row, col: obj.col };

    removeObjectFromGrid(obj); // Temporarily remove it visually
    showDragGhost(obj);

    // Prevent default to avoid text selection
    e.preventDefault();
  }
}

// For placing a **new** object by clicking on a tile
function handleTileClick(e) {
  if (!currentObject || activeMode !== 'place') return;

  // Check if we already have the allowed number of each object
  if (currentObject.className === 'hq' && hqCount >= 1) {
    alert('Only 1 HQ allowed!');
    return;
  }
  if (currentObject.className === 'bear-trap' && bearTrapCount >= 2) {
    alert('Only 2 Bear Traps allowed!');
    return;
  }

  const tile = getTileFromMouseEvent(e);
  if (!tile) return;

  // Center-based approach for new object
  const size = currentObject.size;
  const half = (size - 1) / 2; // can be 1 for 3x3, or 0.5 for 2x2, etc.

  let row = tile.row - half;
  let col = tile.col - half;
  // Round or floor if you want only integer tile placement
  row = Math.floor(row);
  col = Math.floor(col);

  // Clamp
  if (row < 0) row = 0;
  if (col < 0) col = 0;
  if (row + size > gridSize) row = gridSize - size;
  if (col + size > gridSize) col = gridSize - size;

  // Validate
  if (!canPlaceObject(row, col, size)) {
    // Invalid placement - return!
    return;
  }

  // Create the object
  const newObj = {
    id: crypto.randomUUID(),
    row, col,
    size,
    className: currentObject.className,
    name: ''
  };
  placedObjects.push(newObj);

  // Adjust counters
  if (currentObject.className === 'hq')        hqCount++;
  if (currentObject.className === 'bear-trap') bearTrapCount++;

  refreshGrid();
}

function handleMouseMove(e) {
  // If not dragging an existing object, do nothing here
  if (!isDragging || !draggedObject) return;

  // 1) Position the ghost so its center is at (pageX, pageY)
  //    (CSS has translate(-50%, -50%) to center it)
  dragGhost.style.left = e.pageX + 'px';
  dragGhost.style.top  = e.pageY + 'px';

  // 2) Clear previous coverage/borders
  clearRealTimeCoverage();

  // 3) Find tile under mouse => highlight NxN
  const tileUnderMouse = getTileFromMouseEvent(e);
  if (!tileUnderMouse) return;

  // Compute center-based top-left
  const size = draggedObject.size;
  const half = (size - 1) / 2;
  let row = tileUnderMouse.row - half;
  let col = tileUnderMouse.col - half;
  row = Math.floor(row);
  col = Math.floor(col);

  // If in bounds, highlight coverage/borders in real-time
  if (
    row >= 0 && col >= 0 &&
    row + size <= gridSize && col + size <= gridSize
  ) {
    // Example coverage: if HQ => highlight 7-tile radius
    if (draggedObject.className === 'hq') {
      highlightTerritory(row + 1, col + 1, 7);
    }
    // If banner => radius 3
    else if (draggedObject.className === 'banner') {
      highlightTerritory(row, col, 3);
    }
    // Then highlight the NxN border
    highlightObjectBorderCenterBased(row, col, size);
  }
}

function handleMouseUp(e) {
  if (!isDragging || !draggedObject) return;
  isDragging = false;

  // Hide ghost
  dragGhost.style.display = 'none';

  const tileUnderMouse = getTileFromMouseEvent(e);
  if (!tileUnderMouse) {
    // Dropped outside => revert to original
    placeObjectOnGrid(
      dragOriginalPos.row, 
      dragOriginalPos.col, 
      draggedObject.className, 
      draggedObject.size,
      draggedObject
    );
    draggedObject.row = dragOriginalPos.row;
    draggedObject.col = dragOriginalPos.col;
    draggedObject = null;
    return;
  }

  // Compute final row/col so that tileUnderMouse is center
  const size = draggedObject.size;
  const half = (size - 1) / 2;
  let row = tileUnderMouse.row - half;
  let col = tileUnderMouse.col - half;
  row = Math.floor(row);
  col = Math.floor(col);

  // Clamp
  if (row < 0) row = 0;
  if (col < 0) col = 0;
  if (row + size > gridSize) row = gridSize - size;
  if (col + size > gridSize) col = gridSize - size;

  // Check if valid
  if (!canPlaceObject(row, col, size)) {
    // Invalid, revert to original
    placeObjectOnGrid(
      dragOriginalPos.row, 
      dragOriginalPos.col, 
      draggedObject.className, 
      draggedObject.size,
      draggedObject
    );
    draggedObject.row = dragOriginalPos.row;
    draggedObject.col = dragOriginalPos.col;
    draggedObject = null;

    // Clear any real-time border and coverage highlights
    clearRealTimeCoverage();

    // Hide the placement preview element if it exists
    if (placementPreview) {
      placementPreview.style.display = 'none';
    }
    
    return;
  }

  // Valid => place at new location
  draggedObject.row = row;
  draggedObject.col = col;
  placeObjectOnGrid(row, col, draggedObject.className, size, draggedObject);
  draggedObject = null;

  // Clear coverage
  clearRealTimeCoverage();
}

/* --------------------------------------------------
    Naming Mode
-------------------------------------------------- */
function handleNameSetting(e) {
  const tileIndex = parseInt(e.target.dataset.index);
  const row = Math.floor(tileIndex / gridSize);
  const col = tileIndex % gridSize;

  // Find object
  const obj = findObjectAt(row, col);
  if (!obj) {
    alert('No object here to name.');
    return;
  }

  // Restrict naming to certain classes
  const allowed = ['furnace','hq','bear-trap'];
  if (!allowed.includes(obj.className)) {
    alert('Naming only for HQ, Bear Traps, and Furnaces.');
    return;
  }

  const newName = prompt(`Enter a name for this ${obj.className}:`, obj.name || '');
  if (newName === null) return; // canceled

  obj.name = newName.trim();
  refreshGrid();
}

/* --------------------------------------------------
    Utility / Helper Functions
-------------------------------------------------- */
function findObjectAt(row, col) {
  // Search from top to bottom
  // If multiple overlap, returns last placed
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
  clearGridVisualOnly(); // reset everything
  // Re-draw all except the one we removed
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

// Invert transform for isometric, then figure out which tile
function getTileFromMouseEvent(e) {
  const wrapperRect = gridWrapper.getBoundingClientRect();
  const gridRect    = grid.getBoundingClientRect();

  const gridWidth   = grid.offsetWidth;   // e.g. 800
  const gridHeight  = grid.offsetHeight;  // e.g. 800
  const gridOffsetX = (wrapperRect.width - gridWidth) / 2;
  const gridOffsetY = (wrapperRect.height - gridHeight) / 2;

  let mouseX = e.clientX - wrapperRect.left;
  let mouseY = e.clientY - wrapperRect.top;

  if (gridWrapper.classList.contains('isometric')) {
    const style = window.getComputedStyle(gridWrapper);
    const transform = style.transform;
    if (transform && transform !== 'none') {
      try {
        const matrix        = new DOMMatrix(transform);
        const invertedMatrix= matrix.inverse();
        const centerX       = wrapperRect.width / 2;
        const centerY       = wrapperRect.height / 2;

        // Translate so (0,0) is center of wrapper
        mouseX -= centerX;
        mouseY -= centerY;

        const point         = new DOMPoint(mouseX, mouseY);
        const transformed   = point.matrixTransform(invertedMatrix);

        // Re-add
        mouseX = transformed.x + centerX;
        mouseY = transformed.y + centerY;
      } catch (err) {
        console.error('Matrix inversion failed:', err);
      }
    }
  }

  // Adjust for the grid offset inside the wrapper
  mouseX -= gridOffsetX;
  mouseY -= gridOffsetY;

  // Convert to tile indices
  const tileSize = 20;
  const col = Math.floor(mouseX / tileSize);
  const row = Math.floor(mouseY / tileSize);

  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
    return null;
  }
  return { row, col };
}

// Clears highlight/coverage on all tiles, then re-draw existing objects
function clearRealTimeCoverage() {
  const tiles = document.querySelectorAll('.tile');
  tiles.forEach(tile => {
    if (
      !tile.classList.contains('bear-trap') &&
      !tile.classList.contains('hq') &&
      !tile.classList.contains('furnace') &&
      !tile.classList.contains('banner') &&
      !tile.classList.contains('resource-node') &&
      !tile.classList.contains('non-buildable-area')
    ) {
      tile.classList.remove('covered');
    }
    tile.classList.remove(
      'object-border-top','object-border-right',
      'object-border-bottom','object-border-left'
    );
  });

  // Re-draw coverage/borders for all placed objects except the one being dragged
  for (const obj of placedObjects) {
    if (obj !== draggedObject) {
      applyObjectBorder(obj.row, obj.col, obj.size);
      if (obj.className === 'hq') {
        highlightTerritory(obj.row + 1, obj.col + 1, 7);
      } else if (obj.className === 'banner') {
        highlightTerritory(obj.row, obj.col, 3);
      }
    }
  }
}

// Center-based border highlight
function highlightObjectBorderCenterBased(topLeftRow, topLeftCol, size) {
  const tiles = document.querySelectorAll('.tile');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (topLeftRow + r) * gridSize + (topLeftCol + c);
      const tile  = tiles[index];
      if (!tile) continue;

      // Perimeter
      if (r === 0)         tile.classList.add('object-border-top');
      if (r === size - 1)  tile.classList.add('object-border-bottom');
      if (c === 0)         tile.classList.add('object-border-left');
      if (c === size - 1)  tile.classList.add('object-border-right');
    }
  }
}

// "can I place size×size at row,col?"
function canPlaceObject(row, col, size) {
  if (row + size > gridSize || col + size > gridSize) return false;
  const tiles = document.querySelectorAll('.tile');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (row + r) * gridSize + (col + c);
      // collision check
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

// Coverage highlight for HQ/Banner
function highlightTerritory(centerRow, centerCol, radius) {
  const tiles = document.querySelectorAll('.tile');
  for (let r = -radius; r <= radius; r++) {
    for (let c = -radius; c <= radius; c++) {
      const rr = centerRow + r;
      const cc = centerCol + c;
      if (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
        const index = rr * gridSize + cc;
        // Only highlight if it's not occupied by something else
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

/* --------------------------------------------------
    Placing and Drawing
-------------------------------------------------- */
function placeObjectOnGrid(row, col, className, size, obj) {
  const tiles = document.querySelectorAll('.tile');
  // Fill the NxN area
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (row + r) * gridSize + (col + c);
      tiles[index].classList.add(className);
      // Remove coverage/borders
      tiles[index].classList.remove(
        'object-border-top','object-border-right',
        'object-border-bottom','object-border-left','covered'
      );
    }
  }
  // Outline
  applyObjectBorder(row, col, size);

  // HQ or banner coverage
  if (className === 'hq') {
    highlightTerritory(row + 1, col + 1, 7);
  } else if (className === 'banner') {
    highlightTerritory(row, col, 3);
  }

  // Draw label if object has a name
  if (obj && obj.name) {
    // Remove old label if any
    const existingLabel = document.querySelector(`[data-object-id="${obj.id}"]`);
    if (existingLabel) existingLabel.remove();

    const labelDiv = document.createElement('div');
    labelDiv.classList.add('name-label');
    labelDiv.textContent = obj.name;
    labelDiv.dataset.objectId = obj.id;
    // Rough position; we'll fix in refreshLabelPositions
    labelDiv.style.left = `${col * 20 + (size * 20)/2}px`;
    labelDiv.style.top  = `${row * 20 + (size * 20)/2}px`;

    document.getElementById('labels-overlay').appendChild(labelDiv);

    requestAnimationFrame(() => {
      refreshLabelPositions();
    });
  }
}

function applyObjectBorder(row, col, size) {
  // Basic black outline on the NxN perimeter
  const tiles = document.querySelectorAll('.tile');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = (row + r) * gridSize + (col + c);
      const tile = tiles[index];
      if (r === 0)         tile.classList.add('object-border-top');
      if (r === size - 1)  tile.classList.add('object-border-bottom');
      if (c === 0)         tile.classList.add('object-border-left');
      if (c === size - 1)  tile.classList.add('object-border-right');
    }
  }
}

/* --------------------------------------------------
    Label Positioning
-------------------------------------------------- */
function refreshLabelPositions() {
  const labelsOverlay = document.getElementById('labels-overlay');
  const labels = labelsOverlay.querySelectorAll('.name-label');
  const containerRect = document.getElementById('grid-container').getBoundingClientRect();

  labels.forEach(label => {
    const objId = label.dataset.objectId;
    const obj   = placedObjects.find(o => o.id === objId);
    if (!obj) return;

    // Compute center in grid coords
    const baseX = obj.col * 20 + (obj.size * 20)/2;
    const baseY = obj.row * 20 + (obj.size * 20)/2;

    // Insert a "dummy" element to measure transform offset
    const measurer = document.createElement('div');
    measurer.style.position = 'absolute';
    measurer.style.left = `${baseX}px`;
    measurer.style.top  = `${baseY}px`;
    measurer.style.width = '1px';
    measurer.style.height= '1px';

    gridWrapper.appendChild(measurer);
    const rect = measurer.getBoundingClientRect();
    gridWrapper.removeChild(measurer);

    label.style.left = `${rect.left - containerRect.left}px`;
    label.style.top  = `${rect.top  - containerRect.top}px`;
  });
}

/* --------------------------------------------------
    Delete Highlight
-------------------------------------------------- */
function createDeleteHighlight() {
  deleteHighlightElement = document.createElement('div');
  deleteHighlightElement.classList.add('delete-highlight');
  deleteHighlightElement.style.cssText = 'width: 0; height: 0; border: none;';
  grid.appendChild(deleteHighlightElement);
}
function updateDeleteHighlight(obj) {
  if (!deleteHighlightElement) createDeleteHighlight();
  const sizePx = obj.size * 20;
  deleteHighlightElement.style.cssText = `
    width: ${sizePx}px;
    height: ${sizePx}px;
    left: ${obj.col * 20}px;
    top:  ${obj.row * 20}px;
    border: 2px solid red;
  `;
}
function clearDeleteHighlight() {
  if (deleteHighlightElement) {
    deleteHighlightElement.style.cssText = 'width: 0; height: 0; border: none;';
  }
}

/* --------------------------------------------------
    Misc / Utility
-------------------------------------------------- */
function clearGrid() {
  const tiles = document.querySelectorAll('.tile');
  tiles.forEach(t => {
    t.className = 'tile'; // reset
    t.dataset.name = '';
  });
  placedObjects = [];
  hqCount = 0;
  bearTrapCount = 0;

  // Remove labels
  const labelsOverlay = document.getElementById('labels-overlay');
  while (labelsOverlay.firstChild) {
    labelsOverlay.removeChild(labelsOverlay.firstChild);
  }

  currentObject = null;
}

function clearGridVisualOnly() {
  // Wipes the tile classes but not the placedObjects array
  const tiles = document.querySelectorAll('.tile');
  tiles.forEach(t => {
    t.className = 'tile';
    t.dataset.name = '';
    t.style.border = '';
    t.textContent = '';
  });
  // Remove all name labels
  const labelsOverlay = document.getElementById('labels-overlay');
  while (labelsOverlay.firstChild) {
    labelsOverlay.removeChild(labelsOverlay.firstChild);
  }
}

function deactivateAllModes() {
  document.querySelectorAll('.active').forEach(btn => btn.classList.remove('active'));

  activeMode = null;
  currentPlacementType = null;
  currentObject = null;
  isDeleteMode = false;
  isNamingMode = false;

  grid.classList.remove('delete-mode-active');

  if (placementPreview) {
    placementPreview.style.display = 'none';
  }
}

function activatePlacementMode(type) {
  const sizeMap = {
    'bear-trap': 3,
    'hq': 3,
    'furnace': 2,
    'banner': 1,
    'resource-node': 2,
    'non-buildable-area': 1
  };

  activeMode = 'place';
  currentPlacementType = type;
  currentObject = {
    className: type,
    size: sizeMap[type]
  };
  document.getElementById(`add-${type}`).classList.add('active');
}

function activateDeleteMode() {
  activeMode = 'delete';
  isDeleteMode = true;
  grid.classList.add('delete-mode-active');
  document.getElementById('delete-mode').classList.add('active');
}

function activateNamingMode() {
  activeMode = 'name';
  isNamingMode = true;
  document.getElementById('set-name').classList.add('active');
}

function recalcCounters() {
  hqCount = 0;
  bearTrapCount = 0;
  placedObjects.forEach(o => {
    if (o.className === 'hq')        hqCount++;
    if (o.className === 'bear-trap') bearTrapCount++;
  });
}

// Saving / Loading
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
      const data = JSON.parse(e.target.result);
      placedObjects = data.map(o => ({
        ...o,
        id: o.id || crypto.randomUUID()
      }));
      recalcCounters();
      clearGridVisualOnly();
      placedObjects.forEach(obj => {
        placeObjectOnGrid(obj.row, obj.col, obj.className, obj.size, obj);
      });
    } catch (err) {
      console.error('Error parsing JSON:', err);
      alert('Failed to load layout. Invalid JSON?');
    }
  };
  reader.readAsText(file);
}

// Placement preview for brand new objects
function handlePlacementPreview(e) {
  if (!currentObject || activeMode !== 'place') return;

  const tile = getTileFromMouseEvent(e);
  if (!tile) {
    if (placementPreview) placementPreview.style.display = 'none';
    return;
  }

  const tileSize = 20;
  const size = currentObject.size;
  const half = (size - 1) / 2;

  let row = tile.row - half;
  let col = tile.col - half;
  row = Math.floor(row);
  col = Math.floor(col);

  // Clamp
  if (row < 0) row = 0;
  if (col < 0) col = 0;
  if (row + size > gridSize) row = gridSize - size;
  if (col + size > gridSize) col = gridSize - size;

  // Create preview if needed
  if (!placementPreview) {
    placementPreview = document.createElement('div');
    placementPreview.className = 'placement-preview';
    grid.appendChild(placementPreview);
  }

  // Check collision
  isValidPlacement = canPlaceObject(row, col, size);
  placementPreview.classList.toggle('invalid', !isValidPlacement);

  // Position
  const sizePx = size * tileSize;
  placementPreview.style.display = 'block';
  placementPreview.style.width  = `${sizePx}px`;
  placementPreview.style.height = `${sizePx}px`;
  placementPreview.style.left   = `${col * tileSize}px`;
  placementPreview.style.top    = `${row * tileSize}px`;

  // Isometric check
  const isIso = document.getElementById('toggle-isometric').checked;
  placementPreview.classList.toggle('isometric', isIso);
}

/* --------------------------------------------------
    Event Listeners
-------------------------------------------------- */
// Toolbar & bottom bar
document.querySelectorAll('#toolbar button, #toolbar-bottom button')
  .forEach(btn => {
    btn.addEventListener('click', function() {
      const isSameButton = this.classList.contains('active');
      deactivateAllModes();
      if (!isSameButton) {
        switch(this.id) {
          case 'delete-mode':   activateDeleteMode(); break;
          case 'set-name':      activateNamingMode();  break;
          case 'clear-grid':    clearGrid();           break;
          case 'save-layout':   saveLayout();          break;
          case 'restore-layout':document.getElementById('load-layout').click(); break;
          default:
            if (this.id.startsWith('add-')) {
              activatePlacementMode(this.id.replace('add-', ''));
            }
        }
      }
    });
  });

// File input for loading layout
document.getElementById('load-layout').addEventListener('change', loadLayout);

// Mousemove for new-object placement preview
grid.addEventListener('mousemove', handlePlacementPreview);
grid.addEventListener('mouseleave', () => {
  if (placementPreview) placementPreview.style.display = 'none';
});

// Mousemove for delete highlight
grid.addEventListener('mousemove', e => {
  if (!isDeleteMode) return;
  const tile = getTileFromMouseEvent(e);
  if (!tile) {
    clearDeleteHighlight();
    return;
  }
  const obj = findObjectAt(tile.row, tile.col);
  if (obj && obj !== lastHoveredObject) {
    updateDeleteHighlight(obj);
    lastHoveredObject = obj;
  } else if (!obj) {
    clearDeleteHighlight();
    lastHoveredObject = null;
  }
});

// Toggle name labels
document.getElementById('toggle-names').addEventListener('change', e => {
  showNames = e.target.checked;
  const overlay = document.getElementById('labels-overlay');
  if (showNames) overlay.classList.add('show-names');
  else           overlay.classList.remove('show-names');
  refreshGrid();
});
document.getElementById('labels-overlay').classList.add('show-names');

// Toggle isometric
const isometricCheckbox = document.getElementById('toggle-isometric');
isometricCheckbox.addEventListener('change', e => {
  const isIso = e.target.checked;

  gridWrapper.classList.toggle('isometric', isIso);
  dragGhost.classList.toggle('isometric', isIso);

  const bottomBar = document.getElementById('toolbar-bottom');
  bottomBar.classList.toggle('isometric', isIso);

  if (placementPreview) {
    placementPreview.classList.toggle('isometric', isIso);
  }
  // Reposition labels smoothly
  animateLabelPositions(500);
});
function animateLabelPositions(duration) {
  const start = performance.now();
  function tick(now) {
    refreshLabelPositions();
    if (now - start < duration) {
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(tick);
}

// Init delete highlight
createDeleteHighlight();

// Initialize grid on page load
createGrid();
