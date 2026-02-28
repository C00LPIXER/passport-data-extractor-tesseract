import React, { useState, useRef } from 'react';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { UploadCloud, FileImage, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

// Set up PDF.js worker using Vite's URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PassportData {
  passportNumber: string;
  surname: string;
  givenNames: string;
  nationality: string;
  dateOfBirth: string;
  sex: string;
  dateOfExpiry: string;
  mrzLine1: string;
  mrzLine2: string;
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [passportData, setPassportData] = useState<PassportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      processFile(file);
    } else {
      setError('Please drop a valid image or PDF file.');
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const processFile = (file: File) => {
    setError(null);
    setPassportData(null);
    setSelectedFile(file);
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const convertPdfToImages = async (file: File): Promise<string[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // 2.0 scale for better OCR
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) continue;
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    
    return images;
  };

  const extractMRZ = (text: string): string[] | null => {
    const lines = text.split('\n').map(l => 
      l.toUpperCase()
       .replace(/\s/g, '')
       .replace(/«/g, '<<')
       .replace(/\[/g, '<')
       .replace(/\]/g, '<')
       .replace(/\(/g, '<')
       .replace(/\)/g, '<')
    );
    
    for (let i = 0; i < lines.length - 1; i++) {
      let l1 = lines[i];
      let l2 = lines[i+1];
      
      if (l1.startsWith('P') && l1.length >= 40 && l2.length >= 40) {
        l1 = l1.padEnd(44, '<').substring(0, 44);
        l2 = l2.padEnd(44, '<').substring(0, 44);
        
        const l2Numbers = (l2.match(/[0-9]/g) || []).length;
        if (l2Numbers > 5) {
           return [l1, l2];
        }
      }
    }
    
    const continuous = lines.join('');
    const match = continuous.match(/(P[A-Z<][A-Z0-9<]{42})([A-Z0-9<]{44})/);
    if (match) {
      return [match[1], match[2]];
    }
    
    return null;
  };

  const cleanMRZLine1 = (line: string): string => {
    // MRZ Line 1 format: P<CCCNNNNN<<NNNNN<<<<<<... (44 chars)
    // OCR commonly misreads '<' as 'C' (visually similar in OCR-B font)
    // This function attempts to restore '<' characters when they've been misread
    if (line.length < 44) return line;

    const nameSection = line.substring(5); // Skip P<CCC (type + country)

    // If << separator already exists, no correction needed
    if (nameSection.includes('<<')) return line;

    let cleaned = nameSection;

    // Step 1: Restore trailing '<' filler characters
    // The name field is padded with '<' but OCR reads them as C, E, L, A, etc.
    // A run of 2+ C's followed by a mix of C/E/L/A at the end is almost certainly filler.
    cleaned = cleaned.replace(/[C<]{2,}[CELA<]*$/, match => '<'.repeat(match.length));

    // Step 2: Restore '<<' separator between surname and given names
    // Use greedy match to find the last 'CC' (misread '<<') before given names + filler
    if (!cleaned.includes('<<')) {
      cleaned = cleaned.replace(/^(.+)CC([A-Z]+<+)$/, '$1<<$2');
    }

    return line.substring(0, 5) + cleaned;
  };

  const parseMRZ = (lines: string[]): PassportData => {
    const [line1Raw, line2] = lines;

    // Clean line 1 to fix OCR misreads of '<' as 'C' etc.
    const line1 = cleanMRZLine1(line1Raw);
    
    const issuingCountry = line1.substring(2, 5).replace(/</g, '');
    const nameString = line1.substring(5).split('<<');
    const surname = nameString[0].replace(/</g, ' ').trim();
    const givenNames = (nameString[1] || '').replace(/</g, ' ').trim();
    
    const passportNumber = line2.substring(0, 9).replace(/</g, '');
    const nationality = line2.substring(10, 13).replace(/</g, '');
    const dobRaw = line2.substring(13, 19);
    const sexRaw = line2.substring(20, 21);
    const expiryRaw = line2.substring(21, 27);
    
    const formatMRZDate = (yymmdd: string) => {
      if (!yymmdd || yymmdd.length !== 6 || yymmdd.includes('<')) return '';
      // Fix common OCR number typos
      const clean = yymmdd.replace(/O/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/Z/g, '2');
      const year = parseInt(clean.substring(0, 2), 10);
      const month = clean.substring(2, 4);
      const day = clean.substring(4, 6);
      
      if (isNaN(year)) return clean;
      
      const currentYear = new Date().getFullYear() % 100;
      const fullYear = year > currentYear + 10 ? 1900 + year : 2000 + year;
      return `${fullYear}-${month}-${day}`;
    };

    return {
      passportNumber,
      surname,
      givenNames,
      nationality: nationality || issuingCountry,
      dateOfBirth: formatMRZDate(dobRaw),
      sex: sexRaw === 'M' ? 'Male' : sexRaw === 'F' ? 'Female' : 'Unspecified',
      dateOfExpiry: formatMRZDate(expiryRaw),
      mrzLine1: line1, // cleaned version
      mrzLine2: line2
    };
  };

  const extractData = async () => {
    if (!selectedFile || !previewUrl) return;

    setIsProcessing(true);
    setError(null);
    setProgressMsg('Initializing OCR engine...');

    try {
      let imageSrcs: string[] = [];
      
      if (selectedFile.type === 'application/pdf') {
        setProgressMsg('Converting PDF to images...');
        imageSrcs = await convertPdfToImages(selectedFile);
      } else {
        imageSrcs = [previewUrl];
      }
      
      let foundData: PassportData | null = null;
      
      for (let i = 0; i < imageSrcs.length; i++) {
        setProgressMsg(`Scanning page ${i + 1} of ${imageSrcs.length}...`);
        
        const result = await Tesseract.recognize(imageSrcs[i], 'eng', {
          logger: m => {
            if (m.status === 'recognizing text') {
              setProgressMsg(`Scanning page ${i + 1}: ${Math.round(m.progress * 100)}%`);
            }
          }
        });
        
        const text = result.data.text;
        const mrzLines = extractMRZ(text);
        
        if (mrzLines) {
          foundData = parseMRZ(mrzLines);
          break; // Stop at first page with valid MRZ
        }
      }
      
      if (foundData) {
        setPassportData(foundData);
      } else {
        throw new Error('Could not detect a valid Machine Readable Zone (MRZ). Please ensure the image is clear and the bottom two lines of the passport are visible.');
      }
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(err.message || 'An error occurred while processing the passport.');
    } finally {
      setIsProcessing(false);
      setProgressMsg('');
    }
  };

  const reset = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setPassportData(null);
    setError(null);
    setProgressMsg('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Passport to Data</h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Upload a passport image or PDF to instantly extract structured data locally using Tesseract OCR. No data leaves your browser.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Left Column: Upload & Preview */}
          <Card className="shadow-md border-slate-200">
            <CardHeader>
              <CardTitle>Passport Document</CardTitle>
              <CardDescription>Upload a clear photo, scan, or PDF of the passport.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!previewUrl ? (
                <div
                  className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer flex flex-col items-center justify-center space-y-4"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  <div className="bg-blue-50 p-4 rounded-full">
                    <UploadCloud className="w-8 h-8 text-blue-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-900">Click to upload or drag and drop</p>
                    <p className="text-xs text-slate-500">SVG, PNG, JPG, GIF or PDF (max. 10MB)</p>
                  </div>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[4/3] flex items-center justify-center">
                    {selectedFile?.type === 'application/pdf' ? (
                      <iframe
                        src={previewUrl}
                        title="PDF preview"
                        className="w-full h-full"
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt="Passport preview"
                        className="max-w-full max-h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-sm text-slate-600">
                      <FileImage className="w-4 h-4" />
                      <span className="truncate max-w-[200px]">{selectedFile?.name}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={reset} disabled={isProcessing}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Change File
                    </Button>
                  </div>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                size="lg"
                onClick={extractData}
                disabled={!previewUrl || isProcessing || !!passportData}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {progressMsg || 'Extracting Data...'}
                  </>
                ) : passportData ? (
                  <>
                    <CheckCircle2 className="mr-2 h-5 w-5" />
                    Extraction Complete
                  </>
                ) : (
                  'Extract Data (Local OCR)'
                )}
              </Button>
            </CardFooter>
          </Card>

          {/* Right Column: Extracted Data */}
          <Card className="shadow-md border-slate-200 h-full">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Extracted Details</span>
                {passportData && <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">MRZ Parsed</Badge>}
              </CardTitle>
              <CardDescription>Data parsed from the Machine Readable Zone (MRZ).</CardDescription>
            </CardHeader>
            <CardContent>
              {!previewUrl && !passportData && !isProcessing && (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-400 space-y-4">
                  <FileImage className="w-12 h-12 opacity-20" />
                  <p className="text-sm">Upload a file to see extracted data</p>
                </div>
              )}

              {isProcessing && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                </div>
              )}

              {passportData && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <DataField label="Passport Number" value={passportData.passportNumber} highlight />
                    <DataField label="Nationality" value={passportData.nationality} />
                    <DataField label="Surname" value={passportData.surname} />
                    <DataField label="Given Names" value={passportData.givenNames} />
                    <DataField label="Date of Birth" value={passportData.dateOfBirth} />
                    <DataField label="Sex" value={passportData.sex} />
                    <DataField label="Date of Expiry" value={passportData.dateOfExpiry} highlight />
                  </div>

                  {(passportData.mrzLine1 || passportData.mrzLine2) && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-500 uppercase tracking-wider">Machine Readable Zone (MRZ)</Label>
                        <div className="bg-slate-900 rounded-md p-4 font-mono text-emerald-400 text-xs sm:text-sm overflow-x-auto whitespace-pre">
                          {passportData.mrzLine1 && <div>{passportData.mrzLine1}</div>}
                          {passportData.mrzLine2 && <div>{passportData.mrzLine2}</div>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DataField({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500 uppercase tracking-wider">{label}</Label>
      <div className={`px-3 py-2 rounded-md border ${highlight ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
        {value || <span className="text-slate-400 italic">Not found</span>}
      </div>
    </div>
  );
}
