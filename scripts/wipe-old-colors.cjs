const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('/home/ubuntu/hamaROK/src');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Select/Dialog backgrounds
  content = content.replace(/bg-\[rgba\(8,10,16,0\.98\)\]/g, 'bg-popover backdrop-blur-xl shadow-2xl');
  
  // Card background 1
  content = content.replace(/bg-\[rgba\(11,15,24,0\.6\)\]/g, 'bg-card/60 backdrop-blur-md shadow-lg');
  
  // Card background 2
  content = content.replace(/bg-\[rgba\(11,15,24,0\.92\)\]/g, 'bg-card backdrop-blur-lg hover:bg-white/5 transition-colors shadow-xl');

  // Card background linear gradient
  content = content.replace(/bg-\[linear-gradient\(160deg,rgba\(16,22,36,0\.74\),rgba\(11,15,24,0\.9\)\)\]/g, 'bg-card backdrop-blur-lg hover:bg-white/5 transition-colors shadow-2xl');

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
  }
});
