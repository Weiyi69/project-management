import React, { useState, useRef, useEffect } from 'react';
import { 
  Clipboard, 
  FileText, 
  FileSpreadsheet, 
  Printer,
  ChevronDown 
} from 'lucide-react';
import { toast } from 'react-hot-toast';

const ExportDropdown = ({ data, filename = 'export' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Copy to clipboard functionality
  const copyToClipboard = async () => {
    try {
      const text = formatDataForClipboard(data);
      await navigator.clipboard.writeText(text);
      toast.success('Data copied to clipboard!');
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      toast.error('Failed to copy to clipboard. Please try again.');
    }
  };

  // Excel export functionality
  const exportToExcel = () => {
    try {
      import('xlsx').then(({ utils, writeFile }) => {
        const worksheet = utils.json_to_sheet(data);
        const workbook = utils.book_new();
        utils.book_append_sheet(workbook, worksheet, 'User Data');
        writeFile(workbook, `${filename}.xlsx`);
        toast.success('Excel file downloaded successfully!');
        setIsOpen(false);
      });
    } catch (err) {
      console.error('Failed to export to Excel:', err);
      toast.error('Failed to export to Excel. Please try again.');
    }
  };

  // PDF export functionality
  const exportToPDF = () => {
    try {
      import('jspdf').then(({ default: jsPDF }) => {
        const doc = new jsPDF();
        const text = formatDataForPDF(data);
        
        // Add title
        doc.setFontSize(16);
        doc.text(`${filename} - User Management Data`, 14, 20);
        
        // Add content
        doc.setFontSize(12);
        doc.text(text, 14, 35);
        
        doc.save(`${filename}.pdf`);
        toast.success('PDF file downloaded successfully!');
        setIsOpen(false);
      });
    } catch (err) {
      console.error('Failed to export to PDF:', err);
      toast.error('Failed to export to PDF. Please try again.');
    }
  };

  // Print functionality
  const printData = () => {
    try {
      const printWindow = window.open('', '_blank');
      const text = formatDataForPrint(data);
      
      printWindow.document.write(`
        <html>
          <head>
            <title>${filename} - User Management Data</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 40px; }
              h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
              .data-section { margin-bottom: 30px; }
              .data-item { margin-bottom: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
              .data-label { font-weight: bold; color: #666; }
              .data-value { margin-top: 5px; }
            </style>
          </head>
          <body>
            <h1>${filename} - User Management Data</h1>
            <div class="data-section">
              ${text}
            </div>
          </body>
        </html>
      `);
      
      printWindow.document.close();
      printWindow.print();
      toast.success('Print dialog opened!');
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to print:', err);
      toast.error('Failed to print. Please try again.');
    }
  };

  // Format data for clipboard
  const formatDataForClipboard = (data) => {
    if (!data || data.length === 0) return 'No data available';
    
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(header => row[header] || '').join('\t')).join('\n');
    return `${headers.join('\t')}\n${rows}`;
  };

  // Format data for PDF
  const formatDataForPDF = (data) => {
    if (!data || data.length === 0) return 'No data available';
    
    let text = '';
    data.forEach((item, index) => {
      text += `\n${index + 1}. ${item.name || 'N/A'}\n`;
      text += `   Email: ${item.email || 'N/A'}\n`;
      text += `   Role: ${item.role || 'N/A'}\n`;
      text += `   Status: ${item.status || 'N/A'}\n`;
      if (item.department) text += `   Department: ${item.department}\n`;
      text += '\n';
    });
    return text;
  };

  // Format data for print
  const formatDataForPrint = (data) => {
    if (!data || data.length === 0) return '<p>No data available</p>';
    
    return data.map((item, index) => `
      <div class="data-item">
        <div class="data-label">${index + 1}. ${item.name || 'N/A'}</div>
        <div class="data-value">
          <strong>Email:</strong> ${item.email || 'N/A'}<br>
          <strong>Role:</strong> ${item.role || 'N/A'}<br>
          <strong>Status:</strong> ${item.status || 'N/A'}<br>
          ${item.department ? `<strong>Department:</strong> ${item.department}<br>` : ''}
        </div>
      </div>
    `).join('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md"
      >
        <Clipboard size={18} />
        Export Data
        <ChevronDown size={16} className={`ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Export Options</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Choose your preferred format</p>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            <button
              onClick={copyToClipboard}
              className="w-full flex items-center gap-3 px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                <Clipboard size={16} className="text-blue-600 dark:text-blue-300" />
              </div>
              <div className="text-left">
                <div className="font-medium">Copy to Clipboard</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Copy as text</div>
              </div>
            </button>

            <button
              onClick={exportToExcel}
              className="w-full flex items-center gap-3 px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <div className="w-8 h-8 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                <FileSpreadsheet size={16} className="text-green-600 dark:text-green-300" />
              </div>
              <div className="text-left">
                <div className="font-medium">Excel (.xlsx)</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Download as Excel file</div>
              </div>
            </button>

            <button
              onClick={exportToPDF}
              className="w-full flex items-center gap-3 px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <div className="w-8 h-8 bg-red-100 dark:bg-red-900 rounded-lg flex items-center justify-center">
                <FileText size={16} className="text-red-600 dark:text-red-300" />
              </div>
              <div className="text-left">
                <div className="font-medium">PDF Document</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Download as PDF file</div>
              </div>
            </button>

            <button
              onClick={printData}
              className="w-full flex items-center gap-3 px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                <Printer size={16} className="text-gray-600 dark:text-gray-300" />
              </div>
              <div className="text-left">
                <div className="font-medium">Print Page</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Open print dialog</div>
              </div>
            </button>
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">All formats include current data</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportDropdown;