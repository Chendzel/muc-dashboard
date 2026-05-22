// Metadata de estaciones ThingSpeak para el proyecto MUC (FONDECYT 1241886)
// Read API keys son read-only — seguro exponer en cliente.

const STATIONS = [
  {
    id: 'providencia-adv',
    name: 'Providencia',
    subtitle: 'viento / luz / radiación',
    type: 'urbana-destacada',
    lat: -33.419189,
    lon: -70.617757,
    channelId: 2865012,
    readKey: 'ZHVO4V54ACWCKMUF',
    cardClass: 's-providencia',
    fields: {
      windSpeed: 'field1',
      windDir: 'field2',
      luxVert: 'field3',
      luxHoriz: 'field4',
      radDiffuse: 'field5',
      radVert: 'field6',
      radHoriz: 'field7'
    },
    solar: false
  },
  {
    id: 'providencia-th',
    name: 'Providencia',
    subtitle: 'temperatura / humedad',
    type: 'urbana-destacada',
    lat: -33.419189,
    lon: -70.617757,
    channelId: 2865013,
    readKey: 'GPW0MWSXAJYXSN69',
    cardClass: 's-providencia',
    fields: {
      temp: 'field1',
      humidity: 'field2'
    },
    solar: false
  },
  {
    id: 'isla-maipo',
    name: 'Isla de Maipo',
    subtitle: 'referencia rural',
    type: 'rural',
    lat: -33.734310,
    lon: -70.910410,
    channelId: 2911247,
    readKey: 'JG5XFI4NB556UKO2',
    cardClass: 's-isla',
    fields: {
      windSpeed: 'field1',
      windDir: 'field2',
      humidity: 'field3',
      temp: 'field4',
      radHoriz: 'field5'
    },
    solar: false
  },
  {
    id: 'san-carlos',
    name: 'San Carlos de Apoquindo',
    subtitle: 'periférica',
    type: 'periferica',
    lat: -33.402116,
    lon: -70.501566,
    channelId: 2950699,
    readKey: 'JLIRRP01JVIYPRBZ',
    cardClass: 's-sancarlos',
    fields: {
      windSpeed: 'field1',
      windDir: 'field2',
      humidity: 'field3',
      temp: 'field4',
      radHoriz: 'field5'
    },
    solar: false
  },
  {
    id: 'chamisero',
    name: 'Chamisero',
    subtitle: 'periférica',
    type: 'periferica',
    lat: -33.305427,
    lon: -70.659170,
    channelId: 2950701,
    readKey: 'KIIWGUYA11WMSIQ9',
    cardClass: 's-chamisero',
    fields: {
      windSpeed: 'field1',
      windDir: 'field2',
      humidity: 'field3',
      temp: 'field4',
      radHoriz: 'field5'
    },
    solar: false
  },
  {
    id: 'renca',
    name: 'Renca',
    subtitle: 'urbana',
    type: 'urbana',
    lat: -33.392900,
    lon: -70.697700,
    channelId: 3027229,
    readKey: 'T40LCTX172ZB9E9F',
    cardClass: 's-renca',
    fields: {
      windSpeed: 'field1',
      windDir: 'field2',
      humidity: 'field3',
      temp: 'field4',
      radHoriz: 'field5',
      voltage: 'field6'
    },
    solar: true
  },
  {
    id: 'stgo-centro',
    name: 'Santiago Centro',
    subtitle: 'urbana',
    type: 'urbana',
    lat: -33.440678,
    lon: -70.636208,
    channelId: 3175711,
    readKey: 'OD4EIUF224PK2IBK',
    cardClass: 's-stgocentro',
    fields: {
      windSpeed: 'field1',
      windDir: 'field2',
      humidity: 'field3',
      temp: 'field4',
      radHoriz: 'field5'
    },
    solar: false
  },
  {
    id: 'cerrillos',
    name: 'Cerrillos',
    subtitle: 'urbana',
    type: 'urbana',
    lat: -33.485247,
    lon: -70.727350,
    channelId: 3218465,
    readKey: 'P5VMMIJP91Q5M6FO',
    cardClass: 's-cerrillos',
    fields: {
      windSpeed: 'field1',
      windDir: 'field2',
      humidity: 'field3',
      temp: 'field4',
      radHoriz: 'field5'
    },
    solar: false
  }
];

// Helper: construye la URL de ThingSpeak para un canal
function thingspeakUrl(channelId, readKey, results = 1) {
  return `https://api.thingspeak.com/channels/${channelId}/feeds.json?api_key=${readKey}&results=${results}`;
}
