/**
 * Bear Trap Planner v0.3 beta
 * A planning tool for Whiteout Survival bear trap layouts
 */

// Use an IIFE to create proper scope and avoid polluting global namespace
(function() {
  'use strict';

  /* ===========================================
     Configuration Constants
  ============================================== */
  const CONFIG = {
    gridSize: 40,         // 40x40 grid
    tileSize: 20,         // 20px per tile
    objectTypes: {
      'bear-trap': { size: 3, maxCount: 2 },
      'hq': { size: 3, maxCount: 1 },
      'furnace': { size: 2, maxCount: Infinity },
      'banner': { size: 1, maxCount: Infinity },
      'resource-node': { size: 2, maxCount: Infinity },
      'non-buildable-area': { size: 1, maxCount: Infinity }
    },
    coverageRadius: {
      'hq': 7,
      'banner': 3
    },
    furnaceColors: {
      1: '#FFD700', // Gold for 1st row
      2: '#FFA500', // Orange for 2nd row
      3: '#FF8C00', // Dark orange for 3rd row
      other: '#FF6347', // Tomato for other rows
    }
  };

  /* ===========================================
     State Management
  ============================================== */
  const STATE = {
    placedObjects: [],    // All placed objects
    objectCounts: {       // Current count of each object type
      'bear-trap': 0,
      'hq': 0
    },
    mode: {               // Current interaction mode
      active: null,       // 'place', 'delete', 'name'
      currentType: null,  // Current object type for placement
      currentObject: null // Current object definition for placement
    },
    dragging: {
      active: false,
      object: null,
      originalPos: null
    },
    coverageMap: [],      // Tracks which tiles are covered by HQ/banners
    isUpdating: false,    // Flag to throttle updates
    lastMousePos: { x: null, y: null },
    lastHoveredObject: null
  };

  /* ===========================================
     DOM References
  ============================================== */
  const DOM = {
    grid: null,
    gridWrapper: null,
    cachedTiles: [],
    dragGhost: null,
    placementPreview: null,
    deleteHighlight: null,
    labelsOverlay: null,
    loadingOverlay: null
  };

  /* ===========================================
     Initialization
  ============================================== */
  function init() {
    // Cache DOM elements
    cacheDOMElements();
    
    // Create the grid
    createGrid();
    
    // Initialize coverage map
    initCoverageMap();
    
    // Set up event listeners
    setupEventListeners();
    
    // Create delete highlight
    createDeleteHighlight();

    // Load saved layout (if any)
    showLoading();
    loadLayoutFromLocalStorage()
      .finally(() => {
        hideLoading();
      });
  }

  function cacheDOMElements() {
    DOM.grid = document.getElementById('grid');
    DOM.gridWrapper = document.getElementById('grid-wrapper');
    DOM.dragGhost = document.getElementById('drag-ghost');
    DOM.labelsOverlay = document.getElementById('labels-overlay');
    DOM.loadingOverlay = document.getElementById('loading-overlay');
  }

  function createGrid() {
    const { gridSize } = CONFIG;
    
    for (let i = 0; i < gridSize * gridSize; i++) {
      const tile = document.createElement('div');
      tile.classList.add('tile');
      tile.dataset.index = i;
      // Mouse down could start a drag or naming
      tile.addEventListener('mousedown', handleTileMouseDown);
      DOM.grid.appendChild(tile);
    }

    // Update the cachedTiles array now that the grid is populated
    DOM.cachedTiles = Array.from(document.querySelectorAll('.tile'));
  }

  function initCoverageMap() {
    const { gridSize } = CONFIG;
    
    STATE.coverageMap = Array(gridSize).fill().map(() => 
      Array(gridSize).fill().map(() => ({
        hq: false,
        banner: false
      }))
    );
  }

  function setupEventListeners() {
    // Global mouse events for drag and drop
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Grid events
    DOM.grid.addEventListener('mousemove', handlePlacementPreview);
    DOM.grid.addEventListener('mouseleave', () => {
      if (DOM.placementPreview) DOM.placementPreview.style.display = 'none';
    });
    
    // Grid mouse move for delete highlight
    DOM.grid.addEventListener('mousemove', handleDeleteHighlightUpdate);
    
    // Toolbar buttons
    setupToolbarListeners();
    
    // Toggle labels and isometric view
    setupToggleListeners();
    
    // File input for loading layout
    document.getElementById('load-layout').addEventListener('change', loadLayout);
  }

  function setupToolbarListeners() {
    document.querySelectorAll('#toolbar button, #toolbar-bottom button')
      .forEach(btn => {
        btn.addEventListener('click', function() {
          const isSameButton = this.classList.contains('active');
          deactivateAllModes();
          
          if (!isSameButton) {
            switch(this.id) {
              case 'delete-mode':    activateDeleteMode(); break;
              case 'set-name':       activateNamingMode(); break;
              case 'clear-grid':     clearGrid(); break;
              case 'save-layout':    saveLayout(); break;
              case 'restore-layout': document.getElementById('load-layout').click(); break;
              default:
                if (this.id.startsWith('add-')) {
                  activatePlacementMode(this.id.replace('add-', ''));
                }
            }
          }
        });
      });
  }

  function setupToggleListeners() {
    // Toggle name labels
    document.getElementById('toggle-names').addEventListener('change', e => {
      const showNames = e.target.checked;
      DOM.labelsOverlay.classList.toggle('show-names', showNames);
      refreshGrid();
    });
    DOM.labelsOverlay.classList.add('show-names');
  
    // Toggle isometric
    const isometricCheckbox = document.getElementById('toggle-isometric');
    isometricCheckbox.addEventListener('change', e => {
      const isIso = e.target.checked;
  
      DOM.gridWrapper.classList.toggle('isometric', isIso);
      DOM.dragGhost.classList.toggle('isometric', isIso);
  
      const bottomBar = document.getElementById('toolbar-bottom');
      bottomBar.classList.toggle('isometric', isIso);
  
      if (DOM.placementPreview) {
        DOM.placementPreview.classList.toggle('isometric', isIso);
      }
      
      // Reposition labels smoothly
      animateLabelPositions(500);
      
      // Save the isometric state to localStorage
      saveLayoutToLocalStorage();
    });
  }

  /* ===========================================
     Event Handlers
  ============================================== */
  function handleTileMouseDown(e) {
    const { active: activeMode } = STATE.mode;
    
    if (activeMode === 'delete') {
      handleDeleteClick(e);
      return;
    }

    // Placing new object?
    if (STATE.mode.currentObject) {
      handlePlacementClick(e);
      return;
    }

    // Naming mode?
    if (activeMode === 'name') {
      handleNameSetting(e);
      return;
    }

    // Otherwise, check if user wants to drag an existing object
    handleDragStart(e);
  }

  function handleDeleteClick(e) {
    const tile = getTileFromMouseEvent(e);
    if (!tile) return;

    const obj = findObjectAt(tile.row, tile.col);
    if (obj) {
      removeObject(obj);
      refreshGrid();
      updateStatsDisplay();
      saveLayoutToLocalStorage();
    }
  }

  function handlePlacementClick(e) {
    const { currentObject } = STATE.mode;
    
    if (!currentObject || STATE.mode.active !== 'place') return;

    // Check if we already have the allowed number of each object
    const typeConfig = CONFIG.objectTypes[currentObject.className];
    if (typeConfig && 
        STATE.objectCounts[currentObject.className] >= typeConfig.maxCount) {
      alert(`Only ${typeConfig.maxCount} ${currentObject.className} allowed!`);
      return;
    }

    const tile = getTileFromMouseEvent(e);
    if (!tile) return;

    // Center-based approach for new object
    const size = currentObject.size;
    const half = (size - 1) / 2; // can be 1 for 3x3, or 0.5 for 2x2, etc.

    let row = Math.floor(tile.row - half);
    let col = Math.floor(tile.col - half);

    // Clamp to grid boundaries
    row = Math.max(0, Math.min(row, CONFIG.gridSize - size));
    col = Math.max(0, Math.min(col, CONFIG.gridSize - size));

    // Validate placement
    if (!canPlaceObject(row, col, size)) {
      return;
    }

    // Create the object
    addObject({
      row, col,
      size,
      className: currentObject.className,
      name: ''
    });

    refreshGrid();
    updateStatsDisplay();
    saveLayoutToLocalStorage();
  }

  function handleDragStart(e) {
    const tileIndex = parseInt(e.target.dataset.index);
    const row = Math.floor(tileIndex / CONFIG.gridSize);
    const col = tileIndex % CONFIG.gridSize;

    const obj = findObjectAt(row, col);
    if (obj) {
      STATE.dragging.active = true;
      STATE.dragging.object = obj;
      STATE.dragging.originalPos = { row: obj.row, col: obj.col };

      removeObjectFromGrid(obj); // Temporarily remove it visually
      showDragGhost(obj);

      // Prevent default to avoid text selection
      e.preventDefault();
    }
  }

  function handleMouseMove(e) {
    if (!STATE.dragging.active || !STATE.dragging.object) return;
    if (STATE.isUpdating) return;

    STATE.isUpdating = true;
    requestAnimationFrame(() => {
      try {
        updateDragGhostPosition(e);
      } catch (error) {
        console.error('Error during mousemove update:', error);
      } finally {
        STATE.isUpdating = false;
      }
    });
  }

  function handleMouseUp(e) {
    if (!STATE.dragging.active || !STATE.dragging.object) return;
    STATE.dragging.active = false;

    // Hide ghost
    DOM.dragGhost.style.display = 'none';

    const tileUnderMouse = getTileFromMouseEvent(e);
    if (!tileUnderMouse) {
      // Dropped outside => revert to original
      revertDraggedObject();
      return;
    }

    finalizeDrag(tileUnderMouse);
  }

  function handleDeleteHighlightUpdate(e) {
    if (STATE.mode.active !== 'delete') return;
    
    const tile = getTileFromMouseEvent(e);
    if (!tile) {
      clearDeleteHighlight();
      return;
    }
    
    const obj = findObjectAt(tile.row, tile.col);
    if (obj && obj !== STATE.lastHoveredObject) {
      updateDeleteHighlight(obj);
      STATE.lastHoveredObject = obj;
    } else if (!obj) {
      clearDeleteHighlight();
      STATE.lastHoveredObject = null;
    }
  }

  function handleNameSetting(e) {
    const tileIndex = parseInt(e.target.dataset.index);
    const row = Math.floor(tileIndex / CONFIG.gridSize);
    const col = tileIndex % CONFIG.gridSize;

    // Find object
    const obj = findObjectAt(row, col);
    if (!obj) {
      alert('No object here to name.');
      return;
    }

    // Restrict naming to certain classes
    const allowed = ['furnace', 'hq', 'bear-trap'];
    if (!allowed.includes(obj.className)) {
      alert('Naming only for HQ, Bear Traps, and Furnaces.');
      return;
    }

    const newName = prompt(`Enter a name for this ${obj.className}:`, obj.name || '');
    if (newName === null) return; // canceled

    obj.name = newName.trim();
    refreshGrid();
    saveLayoutToLocalStorage();
  }

  function handlePlacementPreview(e) {
    const { currentObject, active } = STATE.mode;
    if (!currentObject || active !== 'place') return;

    const tile = getTileFromMouseEvent(e);
    if (!tile) {
      if (DOM.placementPreview) DOM.placementPreview.style.display = 'none';
      return;
    }

    updatePlacementPreview(tile);
  }

  /* ===========================================
     Object Management
  ============================================== */
  function addObject(objData) {
    const newObj = {
      id: crypto.randomUUID(),
      ...objData
    };
    
    STATE.placedObjects.push(newObj);

    // Update object counts
    if (newObj.className === 'hq') {
      STATE.objectCounts.hq++;
    } else if (newObj.className === 'bear-trap') {
      STATE.objectCounts['bear-trap']++;
    }
    
    return newObj;
  }

  function removeObject(obj) {
    const index = STATE.placedObjects.indexOf(obj);
    if (index >= 0) {
      STATE.placedObjects.splice(index, 1);
      
      // Update counters
      if (obj.className === 'hq') {
        STATE.objectCounts.hq--;
      } else if (obj.className === 'bear-trap') {
        STATE.objectCounts['bear-trap']--;
      }
    }
  }

  function findObjectAt(row, col) {
    // Search from top to bottom (last placed appears on top)
    for (let i = STATE.placedObjects.length - 1; i >= 0; i--) {
      const obj = STATE.placedObjects[i];
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
    // Remove the object's NxN tile classes
    for (let r = 0; r < obj.size; r++) {
      for (let c = 0; c < obj.size; c++) {
        const index = (obj.row + r) * CONFIG.gridSize + (obj.col + c);
        if (index < DOM.cachedTiles.length) {
          DOM.cachedTiles[index].classList.remove(obj.className);
        }
      }
    }
  }

  function placeObjectOnGrid(row, col, className, size, obj) {
    // Loop over the object's area and add its class to each tile
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const index = (row + r) * CONFIG.gridSize + (col + c);
        if (index < DOM.cachedTiles.length) {
          DOM.cachedTiles[index].classList.add(className);
          // Ensure no leftover "covered" class from previous states
          DOM.cachedTiles[index].classList.remove('covered');
        }
      }
    }
    
    // Optionally update the object's stored position
    if (obj) {
      obj.row = row;
      obj.col = col;
    }
  }

  function canPlaceObject(row, col, size) {
    const { gridSize } = CONFIG;
    
    if (row < 0 || col < 0 || row + size > gridSize || col + size > gridSize) return false;
    
    const tiles = DOM.cachedTiles;
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

  /* ===========================================
     Dragging Functions
  ============================================== */
  function updateDragGhostPosition(e) {
    const tileUnderMouse = getTileFromMouseEvent(e);
    if (!tileUnderMouse) return;
    
    const { object: draggedObject } = STATE.dragging;
    const { tileSize } = CONFIG;
    const size = draggedObject.size;
    const half = (size - 1) / 2;

    // Calculate new grid coordinates
    let row = Math.floor(tileUnderMouse.row - half);
    let col = Math.floor(tileUnderMouse.col - half);

    // Clamp to grid boundaries
    const { gridSize } = CONFIG;
    row = Math.max(0, Math.min(row, gridSize - size));
    col = Math.max(0, Math.min(col, gridSize - size));

    // Update drag ghost position in grid coordinates
    const left = col * tileSize;
    const top = row * tileSize;

    DOM.dragGhost.style.left = `${left}px`;
    DOM.dragGhost.style.top = `${top}px`;
    DOM.dragGhost.style.width = `${size * tileSize}px`;
    DOM.dragGhost.style.height = `${size * tileSize}px`;

    // Clear previous highlights
    clearRealTimeCoverage();

    // Update visual cues if within bounds
    if (row >= 0 && col >= 0 && row + size <= gridSize && col + size <= gridSize) {
      // Highlight territory if needed
      if (draggedObject.className === 'hq') {
        highlightTerritory(row + 1, col + 1, CONFIG.coverageRadius.hq);
      } else if (draggedObject.className === 'banner') {
        highlightTerritory(row, col, CONFIG.coverageRadius.banner);
      }

      // Highlight object borders
      highlightObjectBorderCenterBased(row, col, size);
    }

    // Update label position if needed
    updateLabelForDraggedObject(draggedObject, row, col, size);
  }

  function updateLabelForDraggedObject(draggedObject, row, col, size) {
    if (!draggedObject?.name) return;
    
    const label = document.querySelector(`[data-object-id="${draggedObject.id}"]`);
    if (!label) return;
    
    const { tileSize } = CONFIG;
    
    // Calculate the center of the dragged object in grid coordinates
    const centerX = col * tileSize + (size * tileSize) / 2;
    const centerY = row * tileSize + (size * tileSize) / 2;

    // Use a dummy element to account for isometric transform
    const dummy = document.createElement('div');
    dummy.style.position = 'absolute';
    dummy.style.left = `${centerX}px`;
    dummy.style.top = `${centerY}px`;
    dummy.style.width = '1px';
    dummy.style.height = '1px';

    // Append to grid wrapper to inherit transforms
    DOM.gridWrapper.appendChild(dummy);
    const dummyRect = dummy.getBoundingClientRect();
    DOM.gridWrapper.removeChild(dummy);

    // Position the label relative to the grid container
    const containerRect = document.getElementById('grid-container').getBoundingClientRect();
    label.style.left = `${dummyRect.left - containerRect.left}px`;
    label.style.top = `${dummyRect.top - containerRect.top}px`;
  }

  function showDragGhost(obj) {
    DOM.dragGhost.innerHTML = '';
    DOM.dragGhost.style.display = 'block';
    
    // Set ghost dimensions based on object size
    const { tileSize } = CONFIG;
    DOM.dragGhost.style.width = `${obj.size * tileSize}px`;
    DOM.dragGhost.style.height = `${obj.size * tileSize}px`;
    
    // Create visual representation
    for (let r = 0; r < obj.size; r++) {
      const rowDiv = document.createElement('div');
      rowDiv.style.display = 'flex';
      for (let c = 0; c < obj.size; c++) {
        const cell = document.createElement('div');
        cell.style.width = `${tileSize}px`;
        cell.style.height = `${tileSize}px`;
        cell.style.boxSizing = 'border-box';
        cell.style.border = '1px solid #999';
        cell.classList.add(obj.className);
        rowDiv.appendChild(cell);
      }
      DOM.dragGhost.appendChild(rowDiv);
    }

    // Match grid transformations
    const isIso = document.getElementById('toggle-isometric').checked;
    DOM.dragGhost.classList.toggle('isometric', isIso);
  }

  function revertDraggedObject() {
    const { object: draggedObject, originalPos } = STATE.dragging;
    
    placeObjectOnGrid(
      originalPos.row, 
      originalPos.col, 
      draggedObject.className, 
      draggedObject.size,
      draggedObject
    );
    
    draggedObject.row = originalPos.row;
    draggedObject.col = originalPos.col;
    STATE.dragging.object = null;
  }

  function finalizeDrag(tileUnderMouse) {
    const { object: draggedObject } = STATE.dragging;
    const size = draggedObject.size;
    const half = (size - 1) / 2;
    
    // Compute final row/col so that tileUnderMouse is center
    let row = Math.floor(tileUnderMouse.row - half);
    let col = Math.floor(tileUnderMouse.col - half);

    // Clamp to boundaries
    const { gridSize } = CONFIG;
    row = Math.max(0, Math.min(row, gridSize - size));
    col = Math.max(0, Math.min(col, gridSize - size));

    if (!canPlaceObject(row, col, size)) {
      // Invalid drop: revert to original position
      draggedObject.row = STATE.dragging.originalPos.row;
      draggedObject.col = STATE.dragging.originalPos.col;
      refreshGrid();
      STATE.dragging.object = null;
      return;
    }

    // Valid drop: update position
    draggedObject.row = row;
    draggedObject.col = col;
    refreshGrid();
    updateStatsDisplay();
    saveLayoutToLocalStorage();
    STATE.dragging.object = null;
  }

  /* ===========================================
     Coverage & Visualization
  ============================================== */
  function refreshGrid() {
    // 1. Clear the grid visual state
    clearGridVisualOnly();

    // 2. Place the "base" object tiles for each object
    STATE.placedObjects.forEach(obj => {
      placeObjectOnGrid(obj.row, obj.col, obj.className, obj.size, obj);

      // Apply furnace colors based on row
      if (obj.className === 'furnace') {
        applyFurnaceColors(obj);
      }
    });

    // 3. Reset the coverage map
    initCoverageMap();

    // 4. Compute coverage for each HQ/Banner
    updateCoverageMap();

    // 5. Apply the "covered" class to tiles
    applyVisualCoverage();

    // 6. Apply borders for every object
    STATE.placedObjects.forEach(obj => {
      applyObjectBorder(obj.row, obj.col, obj.size);
    });

    // 7. Re-create labels for objects that have names
    createObjectLabels();

    // 8. Position the labels
    refreshLabelPositions();
  }

  function applyFurnaceColors(furnace) {
    const proximity = getFurnaceProximityToTraps(furnace);
    const color = CONFIG.furnaceColors[proximity] || CONFIG.furnaceColors.other;

    // Check if the furnace is uncovered
    const isUncovered = !isFurnaceCovered(furnace);

    // Apply the color and highlight to each tile of the furnace
    for (let r = 0; r < furnace.size; r++) {
      for (let c = 0; c < furnace.size; c++) {
        const index = (furnace.row + r) * CONFIG.gridSize + (furnace.col + c);
        const tile = DOM.cachedTiles[index];
        if (tile) {
          tile.style.backgroundColor = color;

          // Add a red border for uncovered furnaces
          if (isUncovered) {
            tile.style.border = '2px solid red';
          }
        }
      }
    }
  }

  function updateCoverageMap() {
    STATE.placedObjects.forEach(obj => {
      if (obj.className === 'hq') {
        const coverageArea = calculateCoverage(
          obj.row + 1, obj.col + 1, CONFIG.coverageRadius.hq
        );
        coverageArea.forEach(({ r, c }) => {
          if (r >= 0 && r < CONFIG.gridSize && c >= 0 && c < CONFIG.gridSize) {
            STATE.coverageMap[r][c].hq = true;
          }
        });
      } else if (obj.className === 'banner') {
        const coverageArea = calculateCoverage(
          obj.row, obj.col, CONFIG.coverageRadius.banner
        );
        coverageArea.forEach(({ r, c }) => {
          if (r >= 0 && r < CONFIG.gridSize && c >= 0 && c < CONFIG.gridSize) {
            STATE.coverageMap[r][c].banner = true;
          }
        });
      }
    });
  }

  function applyVisualCoverage() {
    const { gridSize } = CONFIG;
    
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const index = r * gridSize + c;
        const tile = DOM.cachedTiles[index];
        
        // Only add "covered" if the tile is in coverage and not occupied
        if ((STATE.coverageMap[r][c].hq || STATE.coverageMap[r][c].banner) &&
            !tile.classList.contains('hq') &&
            !tile.classList.contains('bear-trap') &&
            !tile.classList.contains('furnace') &&
            !tile.classList.contains('banner') &&
            !tile.classList.contains('resource-node') &&
            !tile.classList.contains('non-buildable-area')) {
          tile.classList.add('covered');
        }
      }
    }
  }

  function calculateCoverage(centerRow, centerCol, radius) {
    const area = [];
    for (let r = -radius; r <= radius; r++) {
      for (let c = -radius; c <= radius; c++) {
        const rr = centerRow + r;
        const cc = centerCol + c;
        if (rr >= 0 && rr < CONFIG.gridSize && cc >= 0 && cc < CONFIG.gridSize) {
          area.push({ r: rr, c: cc });
        }
      }
    }
    return area;
  }

  function clearGridVisualOnly() {
    DOM.cachedTiles.forEach(tile => {
      tile.className = 'tile';
      tile.style.backgroundColor = '';
      tile.style.border = '';
      tile.dataset.name = '';
      tile.textContent = '';
    });

    // Clear labels
    DOM.labelsOverlay.innerHTML = '';
  }

  function clearRealTimeCoverage() {
    DOM.cachedTiles.forEach(tile => {
      // Remove any coverage
      tile.classList.remove('covered');
      // Remove any border classes
      tile.classList.remove(
        'object-border-top',
        'object-border-right',
        'object-border-bottom',
        'object-border-left'
      );
    });
    
    // Re-draw borders and coverage for non-dragged objects
    STATE.placedObjects.forEach(obj => {
      if (obj !== STATE.dragging.object) {
        applyObjectBorder(obj.row, obj.col, obj.size);
        if (obj.className === 'hq') {
          highlightTerritory(obj.row + 1, obj.col + 1, CONFIG.coverageRadius.hq);
        } else if (obj.className === 'banner') {
          highlightTerritory(obj.row, obj.col, CONFIG.coverageRadius.banner);
        }
      }
    });
  }

  function highlightTerritory(centerRow, centerCol, radius) {
    const tiles = DOM.cachedTiles;
    const { gridSize } = CONFIG;
    
    for (let r = -radius; r <= radius; r++) {
      for (let c = -radius; c <= radius; c++) {
        const rr = centerRow + r;
        const cc = centerCol + c;
        if (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
          const index = rr * gridSize + cc;
          // Only highlight if not occupied by something else
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

  function applyObjectBorder(row, col, size) {
    // Basic black outline on the NxN perimeter
    const tiles = DOM.cachedTiles;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const index = (row + r) * CONFIG.gridSize + (col + c);
        if (index < tiles.length) {
          const tile = tiles[index];
          if (r === 0)         tile.classList.add('object-border-top');
          if (r === size - 1)  tile.classList.add('object-border-bottom');
          if (c === 0)         tile.classList.add('object-border-left');
          if (c === size - 1)  tile.classList.add('object-border-right');
        }
      }
    }
  }

  function highlightObjectBorderCenterBased(topLeftRow, topLeftCol, size) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const index = (topLeftRow + r) * CONFIG.gridSize + (topLeftCol + c);
        const tile = DOM.cachedTiles[index];
        if (!tile) continue;

        // Apply border classes to the perimeter
        if (r === 0) tile.classList.add('object-border-top');
        if (r === size - 1) tile.classList.add('object-border-bottom');
        if (c === 0) tile.classList.add('object-border-left');
        if (c === size - 1) tile.classList.add('object-border-right');
      }
    }
  }

  function createObjectLabels() {
    STATE.placedObjects.forEach(obj => {
      if (obj.name) {
        const labelDiv = document.createElement('div');
        labelDiv.classList.add('name-label');
        labelDiv.textContent = obj.name;
        labelDiv.dataset.objectId = obj.id;
        DOM.labelsOverlay.appendChild(labelDiv);
      }
    });
  }

  function refreshLabelPositions() {
    const labels = DOM.labelsOverlay.querySelectorAll('.name-label');
    const containerRect = document.getElementById('grid-container').getBoundingClientRect();

    labels.forEach(label => {
      const objId = label.dataset.objectId;
      const obj = STATE.placedObjects.find(o => o.id === objId);
      if (!obj) return;

      // Compute center in grid coords
      const { tileSize } = CONFIG;
      const baseX = obj.col * tileSize + (obj.size * tileSize) / 2;
      const baseY = obj.row * tileSize + (obj.size * tileSize) / 2;

      // Insert a "dummy" element to measure transform offset
      const measurer = document.createElement('div');
      measurer.style.position = 'absolute';
      measurer.style.left = `${baseX}px`;
      measurer.style.top = `${baseY}px`;
      measurer.style.width = '1px';
      measurer.style.height = '1px';

      DOM.gridWrapper.appendChild(measurer);
      const rect = measurer.getBoundingClientRect();
      DOM.gridWrapper.removeChild(measurer);

      label.style.left = `${rect.left - containerRect.left}px`;
      label.style.top = `${rect.top - containerRect.top}px`;
    });
  }

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

  /* ===========================================
     Delete Mode Functions
  ============================================== */
  function createDeleteHighlight() {
    DOM.deleteHighlight = document.createElement('div');
    DOM.deleteHighlight.classList.add('delete-highlight');
    DOM.deleteHighlight.style.cssText = 'width: 0; height: 0; border: none;';
    DOM.grid.appendChild(DOM.deleteHighlight);
  }

  function updateDeleteHighlight(obj) {
    if (!DOM.deleteHighlight) createDeleteHighlight();
    
    const { tileSize } = CONFIG;
    const sizePx = obj.size * tileSize;
    
    DOM.deleteHighlight.style.cssText = `
      width: ${sizePx}px;
      height: ${sizePx}px;
      left: ${obj.col * tileSize}px;
      top: ${obj.row * tileSize}px;
      border: 2px solid red;
    `;
  }

  function clearDeleteHighlight() {
    if (DOM.deleteHighlight) {
      DOM.deleteHighlight.style.cssText = 'width: 0; height: 0; border: none;';
    }
  }

  /* ===========================================
     Placement Preview
  ============================================== */
  function updatePlacementPreview(tile) {
    const { tileSize } = CONFIG;
    const { currentObject } = STATE.mode;
    const size = currentObject.size;
    const half = (size - 1) / 2;

    // Calculate grid position
    let row = Math.floor(tile.row - half);
    let col = Math.floor(tile.col - half);

    // Clamp to boundaries
    const { gridSize } = CONFIG;
    row = Math.max(0, Math.min(row, gridSize - size));
    col = Math.max(0, Math.min(col, gridSize - size));

    // Create preview if needed
    if (!DOM.placementPreview) {
      DOM.placementPreview = document.createElement('div');
      DOM.placementPreview.className = 'placement-preview';
      DOM.grid.appendChild(DOM.placementPreview);
    }

    // Check if placement is valid
    const isValidPlacement = canPlaceObject(row, col, size);
    DOM.placementPreview.classList.toggle('invalid', !isValidPlacement);

    // Position the preview
    const sizePx = size * tileSize;
    DOM.placementPreview.style.display = 'block';
    DOM.placementPreview.style.width = `${sizePx}px`;
    DOM.placementPreview.style.height = `${sizePx}px`;
    DOM.placementPreview.style.left = `${col * tileSize}px`;
    DOM.placementPreview.style.top = `${row * tileSize}px`;

    // Apply isometric transform if needed
    const isIso = document.getElementById('toggle-isometric').checked;
    DOM.placementPreview.classList.toggle('isometric', isIso);
  }
  
  /* ===========================================
     Statistics Functions
  ============================================== */
  function calculateStats() {
    const stats = {
      banners: 0,
      furnaces: 0,
      uncoveredFurnaces: 0,
      firstRowFurnaces: 0,
      secondRowFurnaces: 0,
      thirdRowFurnaces: 0,
    };

    // Count objects and calculate metrics
    STATE.placedObjects.forEach(obj => {
      if (obj.className === 'banner') {
        stats.banners++;
      } else if (obj.className === 'furnace') {
        stats.furnaces++;

        // Check if furnace is uncovered
        if (!isFurnaceCovered(obj)) {
          stats.uncoveredFurnaces++;
        }

        // Check furnace proximity to bear traps
        const proximity = getFurnaceProximityToTraps(obj);
        if (proximity === 1) stats.firstRowFurnaces++;
        else if (proximity === 2) stats.secondRowFurnaces++;
        else if (proximity === 3) stats.thirdRowFurnaces++;
      }
    });

    return stats;
  }

  function isFurnaceCovered(furnace) {
    const { row, col, size } = furnace;
    let coveredTiles = 0;

    // Check each tile under the furnace
    for (let r = row; r < row + size; r++) {
      for (let c = col; c < col + size; c++) {
        if (STATE.coverageMap[r]?.[c]?.hq || STATE.coverageMap[r]?.[c]?.banner) {
          coveredTiles++;
        }
      }
    }

    // At least 75% of tiles must be covered
    const totalTiles = size * size;
    return coveredTiles >= totalTiles * 0.75;
  }

  function getFurnaceProximityToTraps(furnace) {
    const bearTraps = STATE.placedObjects.filter(obj => obj.className === 'bear-trap');
    let minProximity = Infinity;

    bearTraps.forEach(trap => {
      // Define edges for the bear trap (3x3)
      const trapLeft = trap.col;
      const trapRight = trap.col + 2;
      const trapTop = trap.row;
      const trapBottom = trap.row + 2;

      // Define edges for the furnace (2x2)
      const furnaceLeft = furnace.col;
      const furnaceRight = furnace.col + 1;
      const furnaceTop = furnace.row;
      const furnaceBottom = furnace.row + 1;

      // Calculate horizontal and vertical distances
      const horizontalDistance = Math.max(
        trapLeft - furnaceRight,
        furnaceLeft - trapRight
      );
      const verticalDistance = Math.max(
        trapTop - furnaceBottom,
        furnaceTop - trapBottom
      );

      // Minimum distance is the maximum of horizontal/vertical distances
      const distance = Math.max(horizontalDistance, verticalDistance);

      // Negative distance means the objects overlap or touch
      const effectiveDistance = Math.max(0, distance);

      // Track the smallest distance to any trap
      if (effectiveDistance < minProximity) {
        minProximity = effectiveDistance;
      }
    });

    // Determine proximity based on edge-to-edge distance
    if (minProximity <= 2) return 1; // first row
    if (minProximity <= 4) return 2; // second row
    if (minProximity <= 6) return 3; // third row
    return 0; // Not in any row
  }

  function updateStatsDisplay() {
    const stats = calculateStats();

    document.getElementById('banner-count').textContent = stats.banners;
    document.getElementById('furnace-count').textContent = stats.furnaces;
    document.getElementById('uncovered-furnace-count').textContent = stats.uncoveredFurnaces;
    document.getElementById('first-row-furnace-count').textContent = stats.firstRowFurnaces;
    document.getElementById('second-row-furnace-count').textContent = stats.secondRowFurnaces;
    document.getElementById('third-row-furnace-count').textContent = stats.thirdRowFurnaces;
  }
  
  /* ===========================================
     Mode & UI Functions
  ============================================== */
  function activatePlacementMode(type) {
    const typeConfig = CONFIG.objectTypes[type];
    if (!typeConfig) return;
    
    STATE.mode.active = 'place';
    STATE.mode.currentType = type;
    STATE.mode.currentObject = {
      className: type,
      size: typeConfig.size
    };
    
    document.getElementById(`add-${type}`).classList.add('active');
  }

  function activateDeleteMode() {
    STATE.mode.active = 'delete';
    DOM.grid.classList.add('delete-mode-active');
    document.getElementById('delete-mode').classList.add('active');
  }

  function activateNamingMode() {
    STATE.mode.active = 'name';
    document.getElementById('set-name').classList.add('active');
  }

  function deactivateAllModes() {
    // Remove active class from all buttons
    document.querySelectorAll('.active').forEach(btn => btn.classList.remove('active'));

    // Reset mode state
    STATE.mode.active = null;
    STATE.mode.currentType = null;
    STATE.mode.currentObject = null;
    
    // Remove grid classes
    DOM.grid.classList.remove('delete-mode-active');

    // Hide placement preview
    if (DOM.placementPreview) {
      DOM.placementPreview.style.display = 'none';
    }
  }

  /* ===========================================
     Save & Load Functions
  ============================================== */
  function saveLayout() {
    try {
      // Create a timestamp for the filename
      const now = new Date();
      const dateStr = now.toISOString()
        .replace(/:/g, '-')  // Replace colons with hyphens (not allowed in filenames)
        .replace(/\..+/, '')  // Remove milliseconds
        .replace('T', '_');   // Replace T with underscore for readability
      
      // Create the filename with timestamp
      const filename = `bear-trap-layout_${dateStr}.btpl`;
      
      // Prepare the layout data
      const layoutData = JSON.stringify(STATE.placedObjects);
      
      // First UTF-8 encode the JSON string, then Base64 encode it
      const encodedData = btoa(
        Array.from(new TextEncoder().encode(layoutData))
          .map(byte => String.fromCharCode(byte))
          .join('')
      );
      
      // Create a Blob with the encoded data
      const blob = new Blob([encodedData], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      // Create download link and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link); // Firefox requires the link to be in the body
      link.click();
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
      
      console.log(`Layout saved as ${filename}`);
    } catch (error) {
      console.error('Error saving layout:', error);
      alert('Failed to save layout. Please try again.');
    }
  }
  
  function loadLayout(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    showLoading();
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        let data;
        
        // Check if the file is encoded (has our custom extension)
        if (file.name.endsWith('.btpl')) {
          // Decode the Base64 data
          const encodedData = e.target.result;
          
          // Decode using the same approach as encoding, but in reverse
          // First Base64 decode, then UTF-8 decode
          const binaryString = atob(encodedData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const jsonString = new TextDecoder().decode(bytes);
          
          data = JSON.parse(jsonString);
        } else {
          // Legacy support for old JSON files
          data = JSON.parse(e.target.result);
        }
        
        STATE.placedObjects = data.map(o => ({
          ...o,
          id: o.id || crypto.randomUUID()
        }));
        
        // Update object counters
        recalculateObjectCounts();
        
        // Clear grid first
        clearGridVisualOnly();
        
        // Process placement in chunks to avoid UI freezing
        processObjectsInChunks()
          .then(() => {
            // Final pass: refresh the grid
            refreshGrid();
            updateStatsDisplay();
            hideLoading();
            
            // Save to localStorage for persistence
            saveLayoutToLocalStorage();
          });
      } catch (err) {
        console.error('Error parsing file:', err);
        alert('Failed to load layout. Invalid or corrupted file format.');
        hideLoading();
      }
    };
    
    // Read as text for both formats
    reader.readAsText(file);
  }

  function processObjectsInChunks() {
    const chunkSize = 50;
    let index = 0;
    
    return new Promise(resolve => {
      function processChunk() {
        const end = Math.min(index + chunkSize, STATE.placedObjects.length);
        for (; index < end; index++) {
          const obj = STATE.placedObjects[index];
          placeObjectOnGrid(obj.row, obj.col, obj.className, obj.size, obj);
        }
        if (index < STATE.placedObjects.length) {
          requestAnimationFrame(processChunk);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(processChunk);
    });
  }

  function recalculateObjectCounts() {
    // Reset counters
    STATE.objectCounts = {
      'bear-trap': 0,
      'hq': 0
    };

    // Count objects
    STATE.placedObjects.forEach(o => {
      if (o.className === 'hq') {
        STATE.objectCounts.hq++;
      } else if (o.className === 'bear-trap') {
        STATE.objectCounts['bear-trap']++;
      }
    });
  }

  function showLoading() {
    DOM.loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    DOM.loadingOverlay.style.display = 'none';
  }

  function saveLayoutToLocalStorage() {
    try {
      // Save the current layout to localStorage
      localStorage.setItem('bearTrapPlanner_layout', JSON.stringify(STATE.placedObjects));
      
      // Save isometric view state
      const isIsometric = document.getElementById('toggle-isometric').checked;
      localStorage.setItem('bearTrapPlanner_isometric', isIsometric);
      
      localStorage.setItem('bearTrapPlanner_lastSaved', new Date().toISOString());
      console.log('Layout and view state saved to localStorage');
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
      // If localStorage fails (private browsing, full storage, etc.)
      // We silently fail without bothering the user
    }
  }

  function loadLayoutFromLocalStorage() {
    try {
      // Try to load a saved layout from localStorage
      const savedLayout = localStorage.getItem('bearTrapPlanner_layout');
      if (!savedLayout) {
        console.log('No saved layout found in localStorage');
        return false;
      }
      
      const lastSaved = localStorage.getItem('bearTrapPlanner_lastSaved');
      console.log(`Loading saved layout from ${lastSaved || 'unknown time'}`);
      
      // Parse the saved layout
      STATE.placedObjects = JSON.parse(savedLayout).map(o => ({
        ...o,
        id: o.id || crypto.randomUUID()
      }));
      
      // Update object counters
      recalculateObjectCounts();
      
      // Clear grid first
      clearGridVisualOnly();
      
      // Restore isometric view state if saved
      const isIsometric = localStorage.getItem('bearTrapPlanner_isometric');
      const isIso = isIsometric === 'true';
      if (isIsometric !== null) {
        const isometricCheckbox = document.getElementById('toggle-isometric');
        isometricCheckbox.checked = isIso;
        
        // Apply isometric view based on saved state
        DOM.gridWrapper.classList.toggle('isometric', isIso);
        const bottomBar = document.getElementById('toolbar-bottom');
        bottomBar.classList.toggle('isometric', isIso);
      }
      
      // Process placement in chunks
      return processObjectsInChunks()
        .then(() => {
          refreshGrid();
          updateStatsDisplay();
          
          // If isometric, apply a delayed refresh of label positions to ensure
          // the transform has been fully applied
          if (isIso) {
            // First immediate refresh attempt
            refreshLabelPositions();
            
            // Then several delayed attempts to catch when transform is complete
            setTimeout(() => refreshLabelPositions(), 50);
            setTimeout(() => refreshLabelPositions(), 200);
            setTimeout(() => refreshLabelPositions(), 500);
          }
          
          return true;
        });
    } catch (error) {
      console.error('Failed to load layout from localStorage:', error);
      return Promise.resolve(false);
    }
  }

  function clearSavedLayout() {
    try {
      localStorage.removeItem('bearTrapPlanner_layout');
      localStorage.removeItem('bearTrapPlanner_isometric');
      localStorage.removeItem('bearTrapPlanner_lastSaved');
      console.log('Cleared saved data from localStorage');
    } catch (error) {
      console.error('Failed to clear saved layout:', error);
    }
  }
  /* ===========================================
     Grid Utility Functions
  ============================================== */
  function getTileFromMouseEvent(e) {
    const wrapperRect = DOM.gridWrapper.getBoundingClientRect();
    const gridRect = DOM.grid.getBoundingClientRect();

    const gridWidth = DOM.grid.offsetWidth;
    const gridHeight = DOM.grid.offsetHeight;
    const gridOffsetX = (wrapperRect.width - gridWidth) / 2;
    const gridOffsetY = (wrapperRect.height - gridHeight) / 2;

    let mouseX = e.clientX - wrapperRect.left;
    let mouseY = e.clientY - wrapperRect.top;

    // Handle isometric view
    if (DOM.gridWrapper.classList.contains('isometric')) {
      const style = window.getComputedStyle(DOM.gridWrapper);
      const transform = style.transform;
      if (transform && transform !== 'none') {
        try {
          const matrix = new DOMMatrix(transform);
          const invertedMatrix = matrix.inverse();
          const centerX = wrapperRect.width / 2;
          const centerY = wrapperRect.height / 2;

          // Translate so (0,0) is center of wrapper
          mouseX -= centerX;
          mouseY -= centerY;

          const point = new DOMPoint(mouseX, mouseY);
          const transformed = point.matrixTransform(invertedMatrix);

          // Re-add
          mouseX = transformed.x + centerX;
          mouseY = transformed.y + centerY;
        } catch (err) {
          console.error('Matrix inversion failed:', err);
        }
      }
    }

    // Adjust for grid offset inside wrapper
    mouseX -= gridOffsetX;
    mouseY -= gridOffsetY;

    // Convert to tile indices
    const { tileSize, gridSize } = CONFIG;
    const col = Math.floor(mouseX / tileSize);
    const row = Math.floor(mouseY / tileSize);

    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
      return null;
    }
    
    return { row, col };
  }

  function clearGrid() {
    // Reset all tiles
    DOM.cachedTiles.forEach(t => {
      t.className = 'tile';
      t.style = '';
      t.dataset.name = '';
    });
    
    // Clear objects array
    STATE.placedObjects = [];
    
    // Reset counts
    STATE.objectCounts = {
      'bear-trap': 0,
      'hq': 0
    };
  
    // Clear labels
    DOM.labelsOverlay.innerHTML = '';
  
    // Reset current object
    STATE.mode.currentObject = null;
    
    // Update stats
    updateStatsDisplay();
    
    // Clear saved layout from localStorage
    clearSavedLayout();
  }

  /* ===========================================
     Initialize the application
  ============================================== */
  init();

})();