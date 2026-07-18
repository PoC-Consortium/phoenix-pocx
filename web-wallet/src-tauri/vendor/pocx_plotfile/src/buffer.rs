// Copyright (c) 2025 Proof of Capacity Consortium
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::ptr::NonNull;

/// Page-aligned byte buffer for direct I/O operations
///
/// Direct I/O (O_DIRECT on Unix, FILE_FLAG_NO_BUFFERING on Windows) requires:
/// - Buffer memory address aligned to page/sector boundaries
/// - Buffer size multiple of sector size
/// - File offsets aligned to sector size
///
/// This struct ensures proper memory alignment for safe direct I/O.
pub struct PageAlignedByteBuffer {
    data: Option<Vec<u8>>,
    layout: Layout,
    pointer: NonNull<u8>,
}

impl PageAlignedByteBuffer {
    /// Creates a new page-aligned buffer of the specified size
    ///
    /// # Arguments
    ///
    /// * `buffer_size` - Size of the buffer in bytes
    ///
    /// # Panics
    ///
    /// Panics if memory allocation fails or layout is invalid
    pub fn new(buffer_size: usize) -> Self {
        let align = page_size::get();
        let layout = Layout::from_size_align(buffer_size, align).expect("Invalid layout");

        let pointer = unsafe {
            let ptr = alloc_zeroed(layout);
            if ptr.is_null() {
                panic!("Failed to allocate aligned memory");
            }
            NonNull::new_unchecked(ptr)
        };

        let data = unsafe { Vec::from_raw_parts(pointer.as_ptr(), buffer_size, buffer_size) };

        PageAlignedByteBuffer {
            data: Some(data),
            layout,
            pointer,
        }
    }

    /// Returns a mutable reference to the buffer
    pub fn get_buffer_mut(&mut self) -> &mut Vec<u8> {
        self.data.as_mut().unwrap()
    }

    /// Returns an immutable reference to the buffer
    #[allow(dead_code)]
    pub fn get_buffer_ref(&self) -> &Vec<u8> {
        self.data.as_ref().unwrap()
    }
}

impl Drop for PageAlignedByteBuffer {
    fn drop(&mut self) {
        if let Some(data) = self.data.take() {
            std::mem::forget(data);
            unsafe {
                dealloc(self.pointer.as_ptr(), self.layout);
            }
        }
    }
}

unsafe impl Send for PageAlignedByteBuffer {}
unsafe impl Sync for PageAlignedByteBuffer {}

#[cfg(test)]
mod buffer_tests {
    use super::PageAlignedByteBuffer;

    #[test]
    fn buffer_size_validation() {
        let sizes = [4096, 8192, 16384, 1024 * 1024, 2 * 1024 * 1024];

        for size in &sizes {
            let buffer = PageAlignedByteBuffer::new(*size);

            let vec_ref = buffer.get_buffer_ref();
            assert_eq!(vec_ref.len(), *size, "Buffer should have correct size");
            assert_eq!(
                vec_ref.capacity(),
                *size,
                "Buffer should have correct capacity"
            );
        }
    }

    #[test]
    fn buffer_data_access() {
        let mut buffer = PageAlignedByteBuffer::new(1024);

        {
            let data_mut = buffer.get_buffer_mut();
            assert_eq!(data_mut.len(), 1024);

            for (i, item) in data_mut.iter_mut().enumerate().take(100) {
                *item = (i % 256) as u8;
            }
        }

        {
            let data_ref = buffer.get_buffer_ref();
            assert_eq!(data_ref.len(), 1024);

            for (i, item) in data_ref.iter().enumerate().take(100) {
                assert_eq!(*item, (i % 256) as u8);
            }
        }
    }

    #[test]
    fn buffer_memory_alignment() {
        let buffer = PageAlignedByteBuffer::new(4096);
        let data_ref = buffer.get_buffer_ref();

        let ptr = data_ref.as_ptr();
        let page_size = page_size::get();

        assert_eq!(ptr as usize % page_size, 0, "Buffer should be page-aligned");
    }

    #[test]
    fn buffer_zero_initialization() {
        let buffer = PageAlignedByteBuffer::new(1024);
        let data_ref = buffer.get_buffer_ref();

        for &byte in data_ref.iter() {
            assert_eq!(byte, 0, "Buffer should be zero-initialized");
        }
    }

    #[test]
    fn buffer_thread_safety() {
        use std::sync::Arc;
        use std::thread;

        let buffer = Arc::new(PageAlignedByteBuffer::new(1024));
        let buffer_clone = buffer.clone();

        let handle = thread::spawn(move || {
            let data_ref = buffer_clone.get_buffer_ref();
            assert_eq!(data_ref.len(), 1024);
        });

        handle.join().unwrap();
    }

    #[test]
    fn buffer_large_allocation() {
        let large_size = 16 * 1024 * 1024; // 16MB
        let mut buffer = PageAlignedByteBuffer::new(large_size);

        let data_ref = buffer.get_buffer_ref();
        assert_eq!(data_ref.len(), large_size);

        let data_mut = buffer.get_buffer_mut();
        data_mut[0] = 0xAA;
        data_mut[large_size - 1] = 0xBB;

        let data_ref = buffer.get_buffer_ref();
        assert_eq!(data_ref[0], 0xAA);
        assert_eq!(data_ref[large_size - 1], 0xBB);
    }

    #[test]
    #[should_panic]
    fn buffer_error_handling() {
        let huge_size = usize::MAX;
        let _result = PageAlignedByteBuffer::new(huge_size);
    }
}
