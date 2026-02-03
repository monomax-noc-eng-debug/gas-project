function getMatches() {
  // Mock data simulation
  const mockData = [
    { id: '101', date: '2023-10-25', teamA: 'Alpha', teamB: 'Omega', status: 'Completed' },
    { id: '102', date: '2023-10-26', teamA: 'Beta', teamB: 'Gamma', status: 'Pending' },
    { id: '103', date: '2023-10-27', teamA: 'Delta', teamB: 'Sigma', status: 'In Progress' }
  ];

  // Simulate network delay
  Utilities.sleep(500);

  return JSON.stringify(mockData);
}

function saveMatch(data) {
  // Simulate saving data
  Utilities.sleep(800);

  return JSON.stringify({ success: true, message: 'Match saved successfully', id: data.id || 'new-id' });
}
