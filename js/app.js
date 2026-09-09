/**
 * Destinos Docentes CV - Lógica Principal de la Aplicación
 * Procesa distancias, geolocalización, filtros en tiempo real, mapas y preferencias.
 */

(function () {
  'use strict';

  // --- Estado Global de la App ---
  const state = {
    allPlazas: [],
    filteredPlazas: [],
    origin: {
      nombre: "València",
      provincia: "Valencia",
      lat: 39.4699,
      lng: -0.3763
    },
    maxDistance: 150,
    filters: {
      cuerpo: "MAESTROS",
      especialidad: "ALL",
      tipos: new Set(["VACANTE", "SUSTITUCIÓN INDETERMINADA", "SUSTITUCIÓN DETERMINADA"]),
      itinerante: "ALL",
      jornada: "ALL",
      horarioCentro: "ALL",
      provincia: "ALL",
      searchQuery: ""
    },
    sortBy: "dist_asc",
    currentView: "list", // 'list', 'map', 'stats'
    favorites: new Set(),
    favoritesOrder: [],
    map: null,
    markersGroup: null,
    originMarker: null,
    radiusCircle: null
  };

  // --- Inicialización ---
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadSavedState();
    setupData();
    setupDatalist();
    setupEventListeners();
    applyFiltersAndRender();
  });

  // --- Gestión de Tema (Oscuro / Claro) ---
  function initTheme() {
    const savedTheme = localStorage.getItem('destinos_theme') || 
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(savedTheme);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('destinos_theme', theme);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // --- Carga de Estado Guardado ---
  function loadSavedState() {
    // Cargar favoritos ordenados por preferencia personal
    try {
      const savedOrder = localStorage.getItem('destinos_favorites_order');
      if (savedOrder) {
        state.favoritesOrder = JSON.parse(savedOrder);
      } else {
        const savedFavs = localStorage.getItem('destinos_favorites');
        state.favoritesOrder = savedFavs ? JSON.parse(savedFavs) : [];
      }
      state.favorites = new Set(state.favoritesOrder);
      updateFavCountBadges();
    } catch (e) {
      console.warn("Error al leer favoritos de localStorage:", e);
      state.favoritesOrder = [];
      state.favorites = new Set();
    }

    // Cargar origen guardado
    try {
      const savedOrigin = localStorage.getItem('destinos_origin');
      if (savedOrigin) {
        state.origin = JSON.parse(savedOrigin);
      }
    } catch (e) {
      console.warn("Error al leer origen de localStorage:", e);
    }
  }

  // --- Preparación de Datos ---
  function setupData() {
    if (window.STATS_SUMMARY && window.STATS_SUMMARY.fecha_adjudicacion) {
      const navBadge = document.getElementById('navAdjudicacionDate');
      if (navBadge) {
        navBadge.textContent = `📅 Adjudicación: ${window.STATS_SUMMARY.fecha_adjudicacion}`;
      }
    }

    if (Array.isArray(window.PUESTOS_DATA)) {
      state.allPlazas = window.PUESTOS_DATA;
      if (window.CENTROS_JORNADAS) {
        state.allPlazas.forEach(p => {
          if (!p.jornada) {
            const jInfo = window.CENTROS_JORNADAS[p.codigo_centro];
            if (jInfo) {
              p.jornada = jInfo.tipo;
              p.jornada_desc = jInfo.descripcion;
              p.jornada_corta = jInfo.corta;
            } else {
              p.jornada = 'PARTIDA';
              p.jornada_desc = 'Jornada Partida (9:00 a 17:00)';
              p.jornada_corta = 'Partida 9h-17h';
            }
          }
        });
      }
    } else {
      console.error("No se encontró window.PUESTOS_DATA");
    }

    populateEspecialidadesSelect();
    updateOriginDisplay();
  }

  // --- Llenar Datalist de Municipios ---
  function setupDatalist() {
    const datalist = document.getElementById('municipiosList');
    const input = document.getElementById('originInput');
    if (!datalist || !window.MUNICIPIOS_DATA) return;

    datalist.innerHTML = '';
    window.MUNICIPIOS_DATA.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.nombre;
      opt.label = `${m.nombre} (${m.provincia})`;
      datalist.appendChild(opt);
    });

    if (input && state.origin && state.origin.nombre) {
      input.value = state.origin.nombre;
    }
  }

  // --- Llenar Selector de Especialidades Dinámicamente ---
  function populateEspecialidadesSelect() {
    const select = document.getElementById('filterEspecialidad');
    if (!select) return;

    const currentCuerpo = state.filters.cuerpo;
    const currentVal = state.filters.especialidad;
    select.innerHTML = '<option value="ALL">-- Todas las especialidades --</option>';

    // Contar plazas por especialidad dentro del cuerpo seleccionado
    const counts = {};
    state.allPlazas.forEach(p => {
      const matchCuerpo = currentCuerpo === "ALL" || 
        (currentCuerpo === "MAESTROS" && p.cuerpo.toUpperCase().includes("MAESTRO")) ||
        (currentCuerpo === "SECUNDARIA" && p.cuerpo.toUpperCase().includes("SECUNDARIA")) ||
        (currentCuerpo === "FP" && (p.cuerpo.toUpperCase().includes("PROFESIONAL") || p.cuerpo.toUpperCase().includes("SINGULAR"))) ||
        (currentCuerpo === "EOI" && p.cuerpo.toUpperCase().includes("IDIOMA"));

      if (matchCuerpo) {
        const key = p.codigo_especialidad ? `${p.codigo_especialidad} - ${p.especialidad}` : p.especialidad;
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    // Ordenar por número de plazas descendente
    const sortedKeys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    sortedKeys.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${key} (${counts[key]} plazas)`;
      if (key === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // --- Cálculo Matemático de Distancia (Haversine + Factor de Carretera) ---
  function calculateDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
      return 9999;
    }
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const linearKm = R * c;

    // Factor de sinuosidad de la red viaria de la Comunitat Valenciana (~1.22x)
    return linearKm * 1.22;
  }

  // Estimación realista del tiempo de conducción según distancia
  function estimateDriveTime(km) {
    if (km <= 15) {
      return Math.round(km / 38 * 60); // tramo urbano / cercanías
    } else if (km <= 50) {
      return Math.round(km / 65 * 60); // interurbano / comarcal
    } else {
      return Math.round(km / 85 * 60); // autovía
    }
  }

  function formatTimeEstimate(mins) {
    if (mins < 60) return `~${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `~${h}h ${m > 0 ? m + 'm' : ''}`;
  }

  // --- Actualizar Información del Origen ---
  function updateOriginDisplay() {
    const originLabel = document.getElementById('currentOriginLabel');
    if (originLabel) {
      originLabel.textContent = `${state.origin.nombre} (${state.origin.provincia || 'CV'})`;
    }
    const originInput = document.getElementById('originInput');
    if (originInput && document.activeElement !== originInput) {
      originInput.value = state.origin.nombre;
    }
  }

  // --- Configuración de Event Listeners ---
  function setupEventListeners() {
    // Tema toggle
    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      setTheme(current === 'dark' ? 'light' : 'dark');
    });

    // Input de Municipio
    const originInput = document.getElementById('originInput');
    originInput.addEventListener('change', () => {
      selectMunicipality(originInput.value);
    });
    originInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        originInput.blur();
        selectMunicipality(originInput.value);
      }
    });

    // Botón GPS
    document.getElementById('btnUseGps').addEventListener('click', locateUserViaGPS);

    // Slider de Distancia
    const distSlider = document.getElementById('maxDistance');
    const distDisplay = document.getElementById('distanceValDisplay');
    distSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state.maxDistance = val;
      distDisplay.textContent = val >= 150 ? "Todas las distancias" : `Hasta ${val} km`;
      applyFiltersAndRender();
    });

    // Filtro Cuerpo
    document.getElementById('filterCuerpo').addEventListener('change', (e) => {
      state.filters.cuerpo = e.target.value;
      state.filters.especialidad = "ALL";
      populateEspecialidadesSelect();
      applyFiltersAndRender();
    });

    // Filtro Especialidad
    document.getElementById('filterEspecialidad').addEventListener('change', (e) => {
      state.filters.especialidad = e.target.value;
      applyFiltersAndRender();
    });

    // Pills de Tipo de Plaza
    const tipoPills = document.querySelectorAll('#tipoPills .pill-btn');
    tipoPills.forEach(pill => {
      pill.addEventListener('click', () => {
        const val = pill.getAttribute('data-val');
        if (state.filters.tipos.has(val)) {
          // Si es el único activo, no dejarlo vacío
          if (state.filters.tipos.size > 1) {
            state.filters.tipos.delete(val);
            pill.classList.remove('active');
          }
        } else {
          state.filters.tipos.add(val);
          pill.classList.add('active');
        }
        applyFiltersAndRender();
      });
    });

    // Filtro Itinerante
    document.getElementById('filterItinerante').addEventListener('change', (e) => {
      state.filters.itinerante = e.target.value;
      applyFiltersAndRender();
    });

    // Filtro Jornada / Horas
    document.getElementById('filterJornada').addEventListener('change', (e) => {
      state.filters.jornada = e.target.value;
      applyFiltersAndRender();
    });

    // Filtro Jornada del Centro (Conselleria)
    const filterHorario = document.getElementById('filterHorarioCentro');
    if (filterHorario) {
      filterHorario.addEventListener('change', (e) => {
        state.filters.horarioCentro = e.target.value;
        applyFiltersAndRender();
      });
    }

    // Filtro Provincia
    document.getElementById('filterProvincia').addEventListener('change', (e) => {
      state.filters.provincia = e.target.value;
      applyFiltersAndRender();
    });

    // Búsqueda de texto en vivo
    document.getElementById('searchInput').addEventListener('input', (e) => {
      state.filters.searchQuery = e.target.value.trim().toLowerCase();
      applyFiltersAndRender();
    });

    // Resetear filtros
    document.getElementById('btnResetFilters').addEventListener('click', resetAllFilters);

    // Selector de Orden
    document.getElementById('sortSelect').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFiltersAndRender();
    });

    // Pestañas de Vista (Listado, Mapa, Estadísticas)
    document.getElementById('tabList').addEventListener('click', () => switchView('list'));
    document.getElementById('tabMap').addEventListener('click', () => switchView('map'));
    document.getElementById('tabStats').addEventListener('click', () => switchView('stats'));

    // Modal / Drawer de Favoritos
    document.getElementById('btnOpenFavorites').addEventListener('click', openFavoritesDrawer);
    document.getElementById('btnCloseDrawer').addEventListener('click', closeFavoritesDrawer);
    document.getElementById('favoritesDrawerBackdrop').addEventListener('click', (e) => {
      if (e.target.id === 'favoritesDrawerBackdrop') closeFavoritesDrawer();
    });
    document.getElementById('btnClearFavorites').addEventListener('click', clearAllFavorites);
    document.getElementById('btnPrintFavorites').addEventListener('click', () => window.print());
    
    const btnCopyFav = document.getElementById('btnCopyFavorites');
    if (btnCopyFav) {
      btnCopyFav.addEventListener('click', copyFavoritesToClipboard);
    }

    const btnSortFav = document.getElementById('btnSortFavByDistance');
    if (btnSortFav) {
      btnSortFav.addEventListener('click', sortFavoritesByDistance);
    }

    // Modal de Donación / Invítame a un café
    const btnOpenDonate = document.getElementById('btnOpenDonate');
    const donateModalBackdrop = document.getElementById('donateModalBackdrop');
    const btnCloseDonateModal = document.getElementById('btnCloseDonateModal');

    if (btnOpenDonate && donateModalBackdrop) {
      btnOpenDonate.addEventListener('click', () => {
        donateModalBackdrop.classList.add('active');
      });
      if (btnCloseDonateModal) {
        btnCloseDonateModal.addEventListener('click', () => {
          donateModalBackdrop.classList.remove('active');
        });
      }
      donateModalBackdrop.addEventListener('click', (e) => {
        if (e.target.id === 'donateModalBackdrop') {
          donateModalBackdrop.classList.remove('active');
        }
      });
    }
  }

  // --- Selección de Municipio desde el input ---
  function selectMunicipality(query) {
    if (!query || !window.MUNICIPIOS_DATA) return;
    const cleanQuery = query.trim().toUpperCase();

    // Búsqueda exacta
    let match = window.MUNICIPIOS_DATA.find(m => m.nombre.toUpperCase() === cleanQuery);

    // Búsqueda parcial si no hay exacta
    if (!match) {
      match = window.MUNICIPIOS_DATA.find(m => m.nombre.toUpperCase().startsWith(cleanQuery));
    }
    if (!match) {
      match = window.MUNICIPIOS_DATA.find(m => m.nombre.toUpperCase().includes(cleanQuery));
    }

    if (match) {
      state.origin = {
        nombre: match.nombre,
        provincia: match.provincia,
        lat: match.lat,
        lng: match.lng
      };
      localStorage.setItem('destinos_origin', JSON.stringify(state.origin));
      updateOriginDisplay();
      applyFiltersAndRender();

      if (state.map) {
        updateMapOrigin();
      }
    }
  }

  // --- Localización por GPS ---
  function locateUserViaGPS() {
    if (!navigator.geolocation) {
      alert("La geolocalización no está soportada por tu navegador.");
      return;
    }

    const btnGps = document.getElementById('btnUseGps');
    btnGps.innerHTML = '<span>⏳</span> Obteniendo GPS...';
    btnGps.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btnGps.innerHTML = '<span>🧭</span> Usar mi GPS';
        btnGps.disabled = false;

        const uLat = pos.coords.latitude;
        const uLng = pos.coords.longitude;

        // Encontrar el municipio más cercano para mostrar un nombre claro
        let closestMun = null;
        let minDist = 999999;
        if (window.MUNICIPIOS_DATA) {
          window.MUNICIPIOS_DATA.forEach(m => {
            const d = calculateDistance(uLat, uLng, m.lat, m.lng);
            if (d < minDist) {
              minDist = d;
              closestMun = m;
            }
          });
        }

        const nom = closestMun && minDist < 15 ? `${closestMun.nombre} (GPS)` : "Mi ubicación GPS";
        const prov = closestMun ? closestMun.provincia : "CV";

        state.origin = {
          nombre: nom,
          provincia: prov,
          lat: uLat,
          lng: uLng
        };

        localStorage.setItem('destinos_origin', JSON.stringify(state.origin));
        updateOriginDisplay();
        applyFiltersAndRender();

        if (state.map) {
          updateMapOrigin();
        }
      },
      (err) => {
        btnGps.innerHTML = '<span>🧭</span> Usar mi GPS';
        btnGps.disabled = false;
        alert(`No se pudo obtener la ubicación GPS (${err.message}). Selecciona tu municipio en el campo de texto.`);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // --- Resetear Filtros ---
  function resetAllFilters() {
    state.filters.cuerpo = "MAESTROS";
    state.filters.especialidad = "ALL";
    state.filters.tipos = new Set(["VACANTE", "SUSTITUCIÓN INDETERMINADA", "SUSTITUCIÓN DETERMINADA"]);
    state.filters.itinerante = "ALL";
    state.filters.jornada = "ALL";
    state.filters.horarioCentro = "ALL";
    state.filters.provincia = "ALL";
    state.filters.searchQuery = "";
    state.maxDistance = 150;
    state.sortBy = "dist_asc";

    document.getElementById('filterCuerpo').value = "MAESTROS";
    document.getElementById('filterItinerante').value = "ALL";
    document.getElementById('filterJornada').value = "ALL";
    const selHorario = document.getElementById('filterHorarioCentro');
    if (selHorario) selHorario.value = "ALL";
    document.getElementById('filterProvincia').value = "ALL";
    document.getElementById('searchInput').value = "";
    document.getElementById('maxDistance').value = "150";
    document.getElementById('distanceValDisplay').textContent = "Todas las distancias";
    document.getElementById('sortSelect').value = "dist_asc";

    document.querySelectorAll('#tipoPills .pill-btn').forEach(b => b.classList.add('active'));

    populateEspecialidadesSelect();
    applyFiltersAndRender();
  }

  // --- Aplicar Filtros y Ordenación ---
  function applyFiltersAndRender() {
    const oLat = state.origin.lat;
    const oLng = state.origin.lng;

    // Calcular distancia y tiempo para todas las plazas
    state.allPlazas.forEach(p => {
      p.distancia_km = calculateDistance(oLat, oLng, p.lat, p.lng);
      p.tiempo_min = estimateDriveTime(p.distancia_km);
    });

    // Filtrar
    state.filteredPlazas = state.allPlazas.filter(p => {
      // Filtro Cuerpo
      if (state.filters.cuerpo !== "ALL") {
        if (state.filters.cuerpo === "MAESTROS" && !p.cuerpo.toUpperCase().includes("MAESTRO")) return false;
        if (state.filters.cuerpo === "SECUNDARIA" && !p.cuerpo.toUpperCase().includes("SECUNDARIA")) return false;
        if (state.filters.cuerpo === "FP" && !(p.cuerpo.toUpperCase().includes("PROFESIONAL") || p.cuerpo.toUpperCase().includes("SINGULAR"))) return false;
        if (state.filters.cuerpo === "EOI" && !p.cuerpo.toUpperCase().includes("IDIOMA")) return false;
      }

      // Filtro Especialidad
      if (state.filters.especialidad !== "ALL") {
        const espKey = p.codigo_especialidad ? `${p.codigo_especialidad} - ${p.especialidad}` : p.especialidad;
        if (espKey !== state.filters.especialidad && p.especialidad !== state.filters.especialidad) {
          return false;
        }
      }

      // Filtro Tipo
      if (!state.filters.tipos.has(p.tipo)) {
        return false;
      }

      // Filtro Itinerante
      if (state.filters.itinerante !== "ALL") {
        if (p.itinerante !== state.filters.itinerante) return false;
      }

      // Filtro Jornada / Horas
      if (state.filters.jornada === "COMPLETA" && !p.es_completa) return false;
      if (state.filters.jornada === "PARCIAL" && p.es_completa) return false;

      // Filtro Horario del Centro (Conselleria)
      if (state.filters.horarioCentro && state.filters.horarioCentro !== "ALL") {
        if (p.jornada !== state.filters.horarioCentro) return false;
      }

      // Filtro Provincia
      if (state.filters.provincia !== "ALL" && p.provincia !== state.filters.provincia) {
        return false;
      }

      // Filtro Distancia máxima
      if (state.maxDistance < 150) {
        if (p.distancia_km > state.maxDistance) return false;
      }

      // Filtro Búsqueda libre de texto
      if (state.filters.searchQuery) {
        const q = state.filters.searchQuery;
        const haystack = `${p.nombre_centro} ${p.codigo_centro} ${p.localidad} ${p.provincia} ${p.comarca} ${p.especialidad} ${p.observaciones} ${p.lloc}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    // Ordenar
    sortPlazas(state.filteredPlazas, state.sortBy);

    // Actualizar Contador
    const countSpan = document.getElementById('countNumber');
    if (countSpan) countSpan.textContent = state.filteredPlazas.length;

    updateFilterChips();

    // Renderizar según vista activa
    if (state.currentView === 'list') {
      renderPlazasList();
    } else if (state.currentView === 'map') {
      renderMapView();
    } else if (state.currentView === 'stats') {
      renderStatsView();
    }
  }

  // --- Ordenación ---
  function sortPlazas(arr, sortBy) {
    if (sortBy === 'dist_asc') {
      arr.sort((a, b) => a.distancia_km - b.distancia_km);
    } else if (sortBy === 'dist_desc') {
      arr.sort((a, b) => b.distancia_km - a.distancia_km);
    } else if (sortBy === 'horas_desc') {
      arr.sort((a, b) => b.horas_num - a.horas_num);
    } else if (sortBy === 'loc_asc') {
      arr.sort((a, b) => a.localidad.localeCompare(b.localidad));
    } else if (sortBy === 'tipo') {
      const order = { "VACANTE": 1, "SUSTITUCIÓN INDETERMINADA": 2, "SUSTITUCIÓN DETERMINADA": 3 };
      arr.sort((a, b) => (order[a.tipo] || 99) - (order[b.tipo] || 99));
    }
  }

  // --- Chips de Filtros Activos ---
  function updateFilterChips() {
    const container = document.getElementById('activeFilterChips');
    if (!container) return;
    container.innerHTML = '';

    if (state.filters.cuerpo !== "ALL") {
      createChip(container, `Cuerpo: ${state.filters.cuerpo}`, () => {
        state.filters.cuerpo = "ALL";
        document.getElementById('filterCuerpo').value = "ALL";
        populateEspecialidadesSelect();
        applyFiltersAndRender();
      });
    }

    if (state.filters.especialidad !== "ALL") {
      createChip(container, `Especialidad: ${state.filters.especialidad}`, () => {
        state.filters.especialidad = "ALL";
        document.getElementById('filterEspecialidad').value = "ALL";
        applyFiltersAndRender();
      });
    }

    if (state.filters.itinerante !== "ALL") {
      createChip(container, `Itinerante: ${state.filters.itinerante}`, () => {
        state.filters.itinerante = "ALL";
        document.getElementById('filterItinerante').value = "ALL";
        applyFiltersAndRender();
      });
    }

    if (state.filters.jornada !== "ALL") {
      createChip(container, `Horas: ${state.filters.jornada}`, () => {
        state.filters.jornada = "ALL";
        document.getElementById('filterJornada').value = "ALL";
        applyFiltersAndRender();
      });
    }

    if (state.filters.horarioCentro && state.filters.horarioCentro !== "ALL") {
      const label = state.filters.horarioCentro === "CONTINUA" ? "🌞 Continua (9-14h)" : 
                   (state.filters.horarioCentro === "PARTIDA" ? "⏱️ Partida (9-17h)" : "🏫 Horario IES");
      createChip(container, label, () => {
        state.filters.horarioCentro = "ALL";
        const sel = document.getElementById('filterHorarioCentro');
        if (sel) sel.value = "ALL";
        applyFiltersAndRender();
      });
    }

    if (state.filters.provincia !== "ALL") {
      createChip(container, `Provincia: ${state.filters.provincia}`, () => {
        state.filters.provincia = "ALL";
        document.getElementById('filterProvincia').value = "ALL";
        applyFiltersAndRender();
      });
    }

    if (state.maxDistance < 150) {
      createChip(container, `< ${state.maxDistance} km`, () => {
        state.maxDistance = 150;
        document.getElementById('maxDistance').value = "150";
        document.getElementById('distanceValDisplay').textContent = "Todas las distancias";
        applyFiltersAndRender();
      });
    }
  }

  function createChip(container, text, onRemove) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span>${text}</span><button type="button">&times;</button>`;
    chip.querySelector('button').addEventListener('click', onRemove);
    container.appendChild(chip);
  }

  // --- Renderizado de Lista de Tarjetas ---
  function renderPlazasList() {
    const container = document.getElementById('plazasListContainer');
    const emptyState = document.getElementById('emptyStateContainer');
    if (!container) return;

    if (state.filteredPlazas.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Para un rendimiento óptimo en listas muy grandes, renderizamos los primeros 250 elementos
    const limit = 300;
    const plazasToRender = state.filteredPlazas.slice(0, limit);

    let html = '';
    plazasToRender.forEach(p => {
      const isFav = state.favorites.has(p.lloc);
      const isItin = p.itinerante === 'SI';
      const borderClass = p.tipo === 'VACANTE' ? 'vacante-border' : 
                         (p.tipo === 'SUSTITUCIÓN INDETERMINADA' ? 'indet-border' : 'det-border');
      
      const tipoClass = p.tipo === 'VACANTE' ? 'vacante' : 
                       (p.tipo === 'SUSTITUCIÓN INDETERMINADA' ? 'indeterminada' : 'determinada');

      const distFmt = p.distancia_km < 9900 ? `${p.distancia_km.toFixed(1)} km` : 'Distancia N/D';
      const timeFmt = p.distancia_km < 9900 ? formatTimeEstimate(p.tiempo_min) : '';

      // Google Maps Route URL
      const gmapsUrl = p.lat && p.lng ? 
        `https://www.google.com/maps/dir/?api=1&origin=${state.origin.lat},${state.origin.lng}&destination=${p.lat},${p.lng}&travelmode=driving` :
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.nombre_centro + ' ' + p.localidad)}`;

      html += `
        <article class="plaza-card ${borderClass}" data-lloc="${p.lloc}">
          <div>
            <div class="plaza-card-top">
              <div class="distance-badge" title="Distancia aproximada por carretera">
                <span>📍</span> <span>${distFmt}</span>
                ${timeFmt ? `<span class="time-estimate">(${timeFmt})</span>` : ''}
              </div>
              <div class="plaza-meta-num">
                #${p.numero} · Lloc: <strong>${p.lloc}</strong>
              </div>
            </div>

            <h3 class="center-title">
              <span class="center-code-badge">${p.codigo_centro || '00000000'}</span>
              ${p.nombre_centro}
            </h3>

            <div class="center-location">
              <span>🏛️ ${p.localidad} (${p.provincia})</span>
              ${p.comarca ? `<span>· ${p.comarca}</span>` : ''}
            </div>

            <div class="badges-row">
              <span class="tag-tipo ${tipoClass}">${p.tipo}</span>
              
              <span class="tag-hours ${p.es_completa ? '' : 'parcial'}">
                ⏱️ ${p.es_completa ? 'Jornada Completa' : p.horas + ' horas (Parcial)'}
              </span>

              ${p.jornada === 'CONTINUA' ? `
                <span class="tag-jornada continua" title="Jornada Continua autorizada por Conselleria (9:00 a 14:00)">
                  🌞 Continua (9h-14h)
                </span>
              ` : (p.jornada === 'PARTIDA' ? `
                <span class="tag-jornada partida" title="Jornada Partida ordinaria (9:00 a 17:00)">
                  ⏱️ Partida (9h-17h)
                </span>
              ` : (p.jornada === 'SECUNDARIA' ? `
                <span class="tag-jornada ies" title="Horario de Instituto (Secundaria / FP)">
                  🏫 Horario IES
                </span>
              ` : ''))}

              ${isItin ? `
                <span class="tag-itinerante">
                  🚗 Itinerante / Compartido
                </span>
              ` : ''}

              ${p.req_ling ? `
                <span class="tag-req">
                  🗣️ ${p.req_ling}
                </span>
              ` : ''}
            </div>

            ${p.observaciones ? `
              <div class="observaciones-box">
                ℹ️ <strong>Observaciones:</strong> ${p.observaciones}
              </div>
            ` : ''}

            ${isItin && p.centros_compartidos && p.centros_compartidos.length > 0 ? `
              <div class="shared-centers-box">
                <div class="shared-title">🏫 Desglose de Centros Compartidos:</div>
                ${p.centros_compartidos.map(sc => `
                  <div class="shared-center-item">
                    <span><strong>${sc.codigo_centro}</strong> - ${sc.nombre_centro} (${sc.localidad})</span>
                    <span><strong>${sc.horas} h</strong></span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <div class="card-footer">
            <div style="font-size:0.75rem; color:var(--text-muted);">
              <strong>${p.especialidad}</strong>
            </div>
            <div style="display:flex; gap:0.4rem; align-items:center;">
              <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn-route" title="Abrir ruta en Google Maps">
                🗺️ Cómo llegar
              </a>
              <button type="button" class="btn-favorite ${isFav ? 'active' : ''}" data-fav-lloc="${p.lloc}" title="Añadir a mi orden de peticiones">
                ${isFav ? '★' : '☆'}
              </button>
            </div>
          </div>
        </article>
      `;
    });

    if (state.filteredPlazas.length > limit) {
      html += `
        <div style="grid-column: 1 / -1; text-align: center; padding: 1.5rem; background: var(--bg-card); border-radius: var(--radius); border: 1px dashed var(--border);">
          <p style="font-weight:600; color:var(--text-muted);">Mostrando las primeras <strong>${limit}</strong> plazas más cercanas.</p>
          <p style="font-size:0.8rem; color:var(--text-light); margin-top:0.25rem;">Usa los filtros de especialidad o distancia máxima para acotar los resultados.</p>
        </div>
      `;
    }

    container.innerHTML = html;

    // Vincular botones de favoritos
    container.querySelectorAll('.btn-favorite').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lloc = btn.getAttribute('data-fav-lloc');
        toggleFavorite(lloc, btn);
      });
    });
  }

  // --- Cambio de Vistas (Listado / Mapa / Estadísticas) ---
  function switchView(viewName) {
    state.currentView = viewName;

    document.getElementById('tabList').classList.toggle('active', viewName === 'list');
    document.getElementById('tabMap').classList.toggle('active', viewName === 'map');
    document.getElementById('tabStats').classList.toggle('active', viewName === 'stats');

    document.getElementById('plazasListContainer').style.display = viewName === 'list' ? 'grid' : 'none';
    document.getElementById('mapViewContainer').classList.toggle('visible', viewName === 'map');
    document.getElementById('statsViewContainer').classList.toggle('visible', viewName === 'stats');

    if (viewName === 'map') {
      initOrUpdateMap();
    } else if (viewName === 'stats') {
      renderStatsView();
    }
  }

  // --- Leaflet Mapa Interactivo ---
  function initOrUpdateMap() {
    if (!state.map) {
      state.map = L.map('map').setView([state.origin.lat, state.origin.lng], 9);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(state.map);

      state.markersGroup = L.layerGroup().addTo(state.map);
    } else {
      setTimeout(() => {
        state.map.invalidateSize();
      }, 100);
    }

    updateMapOrigin();
    renderMapMarkers();
  }

  function updateMapOrigin() {
    if (!state.map) return;

    if (state.originMarker) {
      state.map.removeLayer(state.originMarker);
    }
    if (state.radiusCircle) {
      state.map.removeLayer(state.radiusCircle);
    }

    // Icono Casa de Origen
    const homeIcon = L.divIcon({
      className: 'custom-home-icon',
      html: `<div style="background:#0284c7; color:white; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.1rem; box-shadow:0 0 0 4px white, 0 4px 8px rgba(0,0,0,0.3); border:2px solid #0369a1;">🏡</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    state.originMarker = L.marker([state.origin.lat, state.origin.lng], { icon: homeIcon })
      .addTo(state.map)
      .bindPopup(`<strong>Tu ubicación:</strong><br>${state.origin.nombre} (${state.origin.provincia})`);

    // Radio de distancia si está activo
    if (state.maxDistance < 150) {
      state.radiusCircle = L.circle([state.origin.lat, state.origin.lng], {
        radius: (state.maxDistance / 1.22) * 1000, // radio en metros
        color: '#0284c7',
        fillColor: '#38bdf8',
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '5, 5'
      }).addTo(state.map);
    }
  }

  function renderMapMarkers() {
    if (!state.map || !state.markersGroup) return;
    state.markersGroup.clearLayers();

    // Dibujar marcadores de centros
    const maxMapPoints = 400; // límite para fluidez en móviles
    const pointsToDraw = state.filteredPlazas.filter(p => p.lat && p.lng).slice(0, maxMapPoints);

    pointsToDraw.forEach(p => {
      const color = p.tipo === 'VACANTE' ? '#059669' :
                   (p.tipo === 'SUSTITUCIÓN INDETERMINADA' ? '#2563eb' : '#d97706');

      const pinIcon = L.divIcon({
        className: 'custom-pin-icon',
        html: `<div style="background:${color}; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.35);"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      const popupHtml = `
        <div style="font-family:sans-serif; max-width:260px;">
          <h4 style="font-size:0.95rem; margin:0.2rem 0; color:#0f172a;">${p.nombre_centro}</h4>
          <div style="font-size:0.8rem; color:#475569; margin-bottom:0.4rem;">📍 ${p.localidad} (${p.distancia_km.toFixed(1)} km)</div>
          <div style="font-size:0.75rem; font-weight:700; color:${color}; margin-bottom:0.2rem;">${p.tipo} · ${p.horas}</div>
          ${p.jornada === 'CONTINUA' ? '<div style="font-size:0.75rem; color:#b45309; font-weight:700; margin-bottom:0.3rem;">🌞 Jornada Continua (9:00 a 14:00)</div>' : (p.jornada === 'PARTIDA' ? '<div style="font-size:0.75rem; color:#475569; font-weight:600; margin-bottom:0.3rem;">⏱️ Jornada Partida (9:00 a 17:00)</div>' : '')}
          <div style="font-size:0.75rem; color:#334155;"><strong>${p.especialidad}</strong></div>
          <div style="margin-top:0.6rem;">
            <a href="https://www.google.com/maps/dir/?api=1&origin=${state.origin.lat},${state.origin.lng}&destination=${p.lat},${p.lng}" target="_blank" style="color:#0284c7; font-size:0.8rem; font-weight:600; text-decoration:none;">🗺️ Cómo llegar &rarr;</a>
          </div>
        </div>
      `;

      const marker = L.marker([p.lat, p.lng], { icon: pinIcon }).bindPopup(popupHtml);
      state.markersGroup.addLayer(marker);
    });
  }

  // --- Vista de Estadísticas ---
  function renderStatsView() {
    const grid = document.getElementById('statsDashboardGrid');
    const tableContainer = document.getElementById('statsSpecialtyTableContainer');
    if (!grid || !window.STATS_SUMMARY) return;

    const s = window.STATS_SUMMARY;
    grid.innerHTML = `
      <div class="stat-box">
        <div class="stat-box-num">${s.total_plazas}</div>
        <div class="stat-box-label">Total Plazas Ofertadas</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num" style="color:var(--vacante-badge);">${s.total_vacantes}</div>
        <div class="stat-box-label">Vacantes Disponibles</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num" style="color:var(--indet-badge);">${s.total_sustituciones_indet}</div>
        <div class="stat-box-label">Sustituciones Indeterminadas</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num" style="color:var(--det-badge);">${s.total_sustituciones_det}</div>
        <div class="stat-box-label">Sustituciones Determinadas</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num" style="color:var(--itinerante-badge);">${s.total_itinerantes}</div>
        <div class="stat-box-label">Plazas Itinerantes</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num" style="color:#e11d48;">${s.total_jornada_parcial}</div>
        <div class="stat-box-label">Puestos Tiempo Parcial</div>
      </div>
    `;

    if (s.especialidades_maestros && tableContainer) {
      let tableHtml = `
        <h3 style="margin-bottom:0.75rem; font-size:1.1rem; color:var(--text-main);">Distribución de Plazas por Especialidad (Maestros)</h3>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; background:var(--bg-card); border-radius:var(--radius-sm); overflow:hidden; border:1px solid var(--border); font-size:0.875rem;">
            <thead>
              <tr style="background:var(--bg-main); text-align:left; border-bottom:1px solid var(--border);">
                <th style="padding:0.75rem 1rem;">Especialidad</th>
                <th style="padding:0.75rem 1rem; text-align:center;">Total Plazas</th>
                <th style="padding:0.75rem 1rem; text-align:center;">% sobre el total</th>
              </tr>
            </thead>
            <tbody>
      `;

      const entries = Object.entries(s.especialidades_maestros).sort((a, b) => b[1] - a[1]);
      entries.forEach(([esp, count]) => {
        const pct = ((count / s.total_maestros) * 100).toFixed(1);
        tableHtml += `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:0.65rem 1rem; font-weight:600;">${esp}</td>
            <td style="padding:0.65rem 1rem; text-align:center; font-weight:700; color:var(--primary);">${count}</td>
            <td style="padding:0.65rem 1rem; text-align:center; color:var(--text-muted);">${pct}%</td>
          </tr>
        `;
      });

      tableHtml += `</tbody></table></div>`;
      tableContainer.innerHTML = tableHtml;
    }
  }

  // --- Gestión de Favoritos / Peticiones Guardadas ---
  function toggleFavorite(lloc, btnElem) {
    if (state.favorites.has(lloc)) {
      state.favorites.delete(lloc);
      state.favoritesOrder = state.favoritesOrder.filter(id => id !== lloc);
      if (btnElem) {
        btnElem.classList.remove('active');
        btnElem.textContent = '☆';
      }
    } else {
      state.favorites.add(lloc);
      if (!state.favoritesOrder.includes(lloc)) {
        state.favoritesOrder.push(lloc);
      }
      if (btnElem) {
        btnElem.classList.add('active');
        btnElem.textContent = '★';
      }
    }
    saveFavoritesState();
    updateFavCountBadges();
    renderFavoritesList();
  }

  function saveFavoritesState() {
    localStorage.setItem('destinos_favorites', JSON.stringify(Array.from(state.favorites)));
    localStorage.setItem('destinos_favorites_order', JSON.stringify(state.favoritesOrder));
  }

  function updateFavCountBadges() {
    const c = state.favorites.size;
    const navBadge = document.getElementById('favCountBadge');
    const drawerBadge = document.getElementById('drawerFavCount');
    if (navBadge) navBadge.textContent = c;
    if (drawerBadge) drawerBadge.textContent = c;
  }

  function openFavoritesDrawer() {
    renderFavoritesList();
    document.getElementById('favoritesDrawerBackdrop').classList.add('active');
  }

  function closeFavoritesDrawer() {
    document.getElementById('favoritesDrawerBackdrop').classList.remove('active');
  }

  function clearAllFavorites() {
    if (state.favorites.size === 0) return;
    if (confirm("¿Seguro que deseas vaciar tu selección de plazas guardadas?")) {
      state.favorites.clear();
      state.favoritesOrder = [];
      localStorage.removeItem('destinos_favorites');
      localStorage.removeItem('destinos_favorites_order');
      updateFavCountBadges();
      renderFavoritesList();
      applyFiltersAndRender();
    }
  }

  function sortFavoritesByDistance() {
    if (state.favoritesOrder.length <= 1) return;
    const plazaMap = new Map(state.allPlazas.map(p => [p.lloc, p]));
    state.favoritesOrder.sort((a, b) => {
      const pa = plazaMap.get(a);
      const pb = plazaMap.get(b);
      return (pa ? pa.distancia_km : 9999) - (pb ? pb.distancia_km : 9999);
    });
    saveFavoritesState();
    renderFavoritesList();
  }

  // Mover preferencia arriba (-1) o abajo (+1)
  window.moveFavoriteItem = function (lloc, direction) {
    const idx = state.favoritesOrder.indexOf(lloc);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= state.favoritesOrder.length) return;

    const temp = state.favoritesOrder[idx];
    state.favoritesOrder[idx] = state.favoritesOrder[targetIdx];
    state.favoritesOrder[targetIdx] = temp;

    saveFavoritesState();
    renderFavoritesList();
  };

  // Drag and Drop handlers
  let draggedItemIndex = null;

  window.handleFavDragStart = function (e, index) {
    draggedItemIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
  };

  window.handleFavDragOver = function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  };

  window.handleFavDragLeave = function (e) {
    e.currentTarget.classList.remove('drag-over');
  };

  window.handleFavDrop = function (e, targetIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;

    const item = state.favoritesOrder.splice(draggedItemIndex, 1)[0];
    state.favoritesOrder.splice(targetIndex, 0, item);
    draggedItemIndex = null;

    saveFavoritesState();
    renderFavoritesList();
  };

  window.handleFavDragEnd = function (e) {
    e.currentTarget.classList.remove('dragging');
    draggedItemIndex = null;
    document.querySelectorAll('.fav-card-draggable').forEach(el => el.classList.remove('drag-over'));
  };

  function renderFavoritesList() {
    const container = document.getElementById('favoritesListContainer');
    if (!container) return;

    if (state.favorites.size === 0 || state.favoritesOrder.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:2rem 1rem; color:var(--text-muted);">
          <div style="font-size:2rem; margin-bottom:0.5rem;">⭐</div>
          <p>Aún no has guardado ninguna plaza.</p>
          <p style="font-size:0.8rem; margin-top:0.25rem;">Haz clic en la estrella de cualquier tarjeta para añadirla a tu lista de petición.</p>
        </div>
      `;
      return;
    }

    const plazaMap = new Map(state.allPlazas.map(p => [p.lloc, p]));
    const favPlazas = state.favoritesOrder.map(lloc => plazaMap.get(lloc)).filter(Boolean);

    let html = '<div style="display:flex; flex-direction:column; gap:0.75rem;">';
    favPlazas.forEach((p, index) => {
      const tipoClass = p.tipo === 'VACANTE' ? 'vacante' : 
                       (p.tipo === 'SUSTITUCIÓN INDETERMINADA' ? 'indeterminada' : 'determinada');
      const borderClass = p.tipo === 'VACANTE' ? 'vacante-border' : 
                         (p.tipo === 'SUSTITUCIÓN INDETERMINADA' ? 'indet-border' : 'det-border');

      html += `
        <div class="plaza-card fav-card-draggable ${borderClass}" 
             style="padding:0.85rem; margin-bottom:0;" 
             draggable="true" 
             ondragstart="window.handleFavDragStart(event, ${index})" 
             ondragover="window.handleFavDragOver(event)" 
             ondragleave="window.handleFavDragLeave(event)" 
             ondrop="window.handleFavDrop(event, ${index})" 
             ondragend="window.handleFavDragEnd(event)" 
             data-lloc="${p.lloc}">
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.45rem;">
            <!-- Indicador de orden y botones de subir/bajar -->
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <span class="fav-priority-badge" title="Orden de preferencia #${index + 1}">
                #${index + 1}
              </span>
              <div class="fav-order-controls">
                <button type="button" class="btn-move-fav" onclick="window.moveFavoriteItem('${p.lloc}', -1)" title="Subir preferencia (más prioridad)" ${index === 0 ? 'disabled' : ''}>⬆️</button>
                <button type="button" class="btn-move-fav" onclick="window.moveFavoriteItem('${p.lloc}', 1)" title="Bajar preferencia (menos prioridad)" ${index === favPlazas.length - 1 ? 'disabled' : ''}>⬇️</button>
              </div>
            </div>

            <div style="display:flex; gap:0.3rem; align-items:center;">
              <span class="distance-badge" style="font-size:0.75rem; padding:0.2rem 0.5rem;">
                📍 ${p.distancia_km.toFixed(1)} km (~${p.tiempo_min} min)
              </span>
              <button type="button" style="background:none; border:none; color:#ef4444; font-size:1.1rem; cursor:pointer; padding:0 0.3rem;" onclick="window.removeFavoriteItem('${p.lloc}')" title="Eliminar de mi orden">&times;</button>
            </div>
          </div>

          <!-- Código de centro asociado al nombre -->
          <div style="font-weight:800; font-size:0.95rem; color:var(--text-main); margin-bottom:0.25rem; display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
            <span class="center-code-badge" style="font-size:0.85rem; color:var(--primary); font-weight:800;">${p.codigo_centro}</span>
            <span>${p.nombre_centro}</span>
          </div>

          <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.4rem;">
            🏛️ ${p.localidad} (${p.provincia}) · <strong>${p.especialidad}</strong>
          </div>

          <div class="badges-row" style="margin-bottom:0;">
            <span class="tag-tipo ${tipoClass}" style="font-size:0.7rem; padding:0.15rem 0.45rem;">${p.tipo}</span>
            
            <span class="tag-hours ${p.es_completa ? '' : 'parcial'}" style="font-size:0.7rem; padding:0.15rem 0.45rem;">
              ⏱️ ${p.es_completa ? 'Jornada Completa' : p.horas + 'h'}
            </span>

            ${p.jornada === 'CONTINUA' ? `
              <span class="tag-jornada continua" style="font-size:0.7rem; padding:0.15rem 0.45rem;" title="Jornada Continua (9:00 a 14:00)">
                🌞 Continua 9h-14h
              </span>
            ` : (p.jornada === 'PARTIDA' ? `
              <span class="tag-jornada partida" style="font-size:0.7rem; padding:0.15rem 0.45rem;" title="Jornada Partida (9:00 a 17:00)">
                ⏱️ Partida 9h-17h
              </span>
            ` : (p.jornada === 'SECUNDARIA' ? `
              <span class="tag-jornada ies" style="font-size:0.7rem; padding:0.15rem 0.45rem;" title="Horario IES / Secundaria">
                🏫 Horario IES
              </span>
            ` : ''))}

            ${p.itinerante === 'SI' ? `<span class="tag-itinerante" style="font-size:0.7rem; padding:0.15rem 0.45rem;">🚗 Itinerante</span>` : ''}
            
            <span style="font-size:0.7rem; color:var(--text-muted); margin-left:auto; align-self:center;">
              Lloc: <strong>${p.lloc}</strong>
            </span>
          </div>
        </div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;
  }

  function copyFavoritesToClipboard() {
    const plazaMap = new Map(state.allPlazas.map(p => [p.lloc, p]));
    const favPlazas = state.favoritesOrder.map(lloc => plazaMap.get(lloc)).filter(Boolean);

    if (favPlazas.length === 0) {
      alert("Añade primero algunas plazas a tu lista pulsando la estrella.");
      return;
    }

    const lines = [
      `MI ORDEN DE PETICIÓN - DESTINOS GVA (${state.origin.nombre})`,
      `Fecha: ${new Date().toLocaleDateString()}`,
      `Total centros seleccionados: ${favPlazas.length}`,
      `------------------------------------------------------------`
    ];

    favPlazas.forEach((p, idx) => {
      const jornadaTxt = p.jornada_corta ? ` - ${p.jornada_corta}` : '';
      lines.push(`${idx + 1}. ${p.codigo_centro} ${p.nombre_centro} (${p.localidad}) - ${p.tipo} [${p.horas}]${jornadaTxt} - ${p.distancia_km.toFixed(1)} km (Lloc: ${p.lloc})`);
    });

    const textToCopy = lines.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      const btn = document.getElementById('btnCopyFavorites');
      const origText = btn.innerHTML;
      btn.innerHTML = '<span>✅</span> ¡Copiado!';
      setTimeout(() => {
        btn.innerHTML = origText;
      }, 2000);
    }).catch(() => {
      alert("No se pudo copiar automáticamente al portapapeles.");
    });
  }

  // Exponer función de borrado de favorito en el drawer
  window.removeFavoriteItem = function (lloc) {
    toggleFavorite(lloc);
    applyFiltersAndRender();
  };

})();
